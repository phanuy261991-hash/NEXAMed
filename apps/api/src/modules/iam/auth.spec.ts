import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import {
  AccountDisabledError,
  AccountLockedError,
  AccountLockedPermanentlyError,
  DEFAULT_ROLE_PERMISSIONS,
  InvalidCredentialsError,
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
} from '@nexamed/core';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { TenantDirectoryRepository } from '../tenant-context/tenant-directory.repository';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { SessionRepository } from './session.repository';
import { UserAccountAuthRepository } from './user-account-auth.repository';
import { BranchAccessService } from './branch-access.service';
import { BranchRepository } from './branch.repository';

// Integration test thật trên Postgres cục bộ (docker-compose), không mock — cùng pattern với
// rbac.spec.ts/tenant-isolation.spec.ts. Gọi thẳng AuthService (không qua HTTP/controller) —
// e2e qua HTTP thật để dành S1-07 khi có test harness chung.

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const TEST_PASSWORD = 'Test@12345';
const REQUEST_META = { ip: '127.0.0.1', userAgent: 'vitest' };

function fakeConfigService(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === 'JWT_SECRET') return process.env.JWT_SECRET as string;
      throw new Error(`Không có config key "${key}" trong test`);
    },
  } as unknown as ConfigService;
}

describe('AuthService — login/refresh/logout', () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService();
  const unitOfWork = new UnitOfWorkService(appPrisma);
  const tokenService = new TokenService(new JwtService({}), fakeConfigService());
  const sessionRepository = new SessionRepository();
  const userAccountAuthRepository = new UserAccountAuthRepository();
  const authService = new AuthService(unitOfWork, userAccountAuthRepository, sessionRepository, tokenService, new BranchAccessService(new BranchRepository()), new TenantDirectoryRepository(appPrisma));

  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  const usernameA = `doctor-a-${randomUUID()}`;

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();

    const tenantA = await privileged.tenant.create({
      data: { name: `Auth A ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    const tenantB = await privileged.tenant.create({
      data: { name: `Auth B ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const passwordHash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });
    const userA = await privileged.userAccount.create({
      data: {
        tenantId: tenantAId,
        username: usernameA,
        passwordHash,
        fullName: 'Bác sĩ A',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });
    userAId = userA.id;

    // Gán vai trò 'doctor' cho userA — xác minh login()/getCurrentUser() trả đúng roles
    // (S1-08, docs/DECISIONS.md #022).
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, tenantAId, SYSTEM_ACTOR);
    const doctorRole = await privileged.role.findFirstOrThrow({ where: { tenantId: tenantAId, name: 'doctor' } });
    await privileged.userRole.create({
      data: {
        tenantId: tenantAId,
        userId: userAId,
        roleId: doctorRole.id,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });
  });

  afterAll(async () => {
    await privileged.auditLog.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.userSession.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.userRole.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.rolePermission.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.role.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.userAccount.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    // "Hàng đợi ảo" (#064) — seedDefaultRolesForTenant() nay cũng seed Khoa mặc định ("Khoa
    // chung"), FK RESTRICT department→tenant nên phải xoá trước tenant.
    await privileged.department.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    // "Thu chi tại quầy" GĐ1 — seedDefaultRolesForTenant() nay cũng seed 1 quỹ tiền mặt mặc định
    // (cash_account) qua CodeSequenceRepository (code_sequence) — cả hai FK RESTRICT→tenant.
    await privileged.cashAccount.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    // Kho Thuốc & Vật tư y tế GĐ1 (docs/DECISIONS.md #146) — seedDefaultRolesForTenant() nay cũng
    // seed 1 Kho mặc định (warehouse), cùng FK RESTRICT→tenant như cash_account ở trên.
    await privileged.warehouse.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.codeSequence.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    // Danh mục riêng theo tenant (#230): seedDefaultRolesForTenant nạp dòng danh mục hệ thống cho tenant.
    await privileged.referenceCatalog.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.userBranch.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.branch.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  beforeEach(async () => {
    await privileged.userAccount.update({
      where: { id: userAId },
      data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, lockoutLevel: 0, lockedPermanentlyAt: null, isActive: true },
    });
    await privileged.userSession.deleteMany({ where: { userId: userAId } });
  });

  it('đăng nhập đúng: trả access token, tạo đúng 1 phiên còn hiệu lực', async () => {
    const result = await authService.login(
      { tenantId: tenantAId, username: usernameA, password: TEST_PASSWORD },
      REQUEST_META,
    );
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.username).toBe(usernameA);
    expect(result.user.roles).toEqual(['doctor']);

    const sessions = await privileged.userSession.findMany({ where: { userId: userAId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.deletedAt).toBeNull();
  });

  it('sai mật khẩu → InvalidCredentialsError, tăng failedLoginCount', async () => {
    await expect(
      authService.login({ tenantId: tenantAId, username: usernameA, password: 'wrong' }, REQUEST_META),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const user = await privileged.userAccount.findUniqueOrThrow({ where: { id: userAId } });
    expect(user.failedLoginCount).toBe(1);
  });

  const wrong = () => authService.login({ tenantId: tenantAId, username: usernameA, password: 'wrong' }, REQUEST_META);
  const right = () => authService.login({ tenantId: tenantAId, username: usernameA, password: TEST_PASSWORD }, REQUEST_META);
  // Giả lập "đã chờ hết thời gian khoá" bằng cách đưa lockedUntil về quá khứ (không chờ thật).
  const expireTemporaryLock = () => privileged.userAccount.update({ where: { id: userAId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
  const lockMinutes = async (): Promise<number> => {
    const u = await privileged.userAccount.findUniqueOrThrow({ where: { id: userAId } });
    return Math.round((u.lockedUntil!.getTime() - Date.now()) / 60_000);
  };

  it('4 lần sai vẫn báo "sai thông tin"; lần sai thứ 5 báo NGAY số phút khoá (5 phút), mật khẩu đúng sau đó vẫn bị chặn', async () => {
    for (let i = 0; i < 4; i++) await expect(wrong()).rejects.toBeInstanceOf(InvalidCredentialsError);

    const fifth = await wrong().catch((e: unknown) => e);
    expect(fifth).toBeInstanceOf(AccountLockedError);
    expect((fifth as AccountLockedError).retryAfterMinutes).toBe(5);
    expect((fifth as AccountLockedError).message).toContain('5 phút');

    const user = await privileged.userAccount.findUniqueOrThrow({ where: { id: userAId } });
    expect(user.lockoutLevel).toBe(1);
    expect(user.lockedUntil).not.toBeNull();

    const whileLocked = await right().catch((e: unknown) => e);
    expect(whileLocked).toBeInstanceOf(AccountLockedError);
    expect((whileLocked as AccountLockedError).retryAfterMinutes).toBeLessThanOrEqual(5);
  });

  it('khoá luỹ tiến 5 → 15 → 30 phút rồi MỘT lần sai nữa là khoá vĩnh viễn; mật khẩu đúng cũng bị chặn; nhật ký ghi sự kiện', async () => {
    for (let i = 0; i < 5; i++) await wrong().catch(() => undefined);
    expect(await lockMinutes()).toBe(5);

    await expireTemporaryLock();
    for (let i = 0; i < 4; i++) await expect(wrong()).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(wrong()).rejects.toBeInstanceOf(AccountLockedError);
    expect(await lockMinutes()).toBe(15);

    await expireTemporaryLock();
    for (let i = 0; i < 4; i++) await expect(wrong()).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(wrong()).rejects.toBeInstanceOf(AccountLockedError);
    expect(await lockMinutes()).toBe(30);

    await expireTemporaryLock();
    // Chỉ MỘT lần sai sau khoá 30 phút.
    await expect(wrong()).rejects.toBeInstanceOf(AccountLockedPermanentlyError);
    const user = await privileged.userAccount.findUniqueOrThrow({ where: { id: userAId } });
    expect(user.lockedPermanentlyAt).not.toBeNull();
    expect(user.lockedUntil).toBeNull();

    await expect(right()).rejects.toBeInstanceOf(AccountLockedPermanentlyError);
    const events = await privileged.auditLog.count({ where: { tenantId: tenantAId, entityId: userAId, action: 'auth.account_locked_permanently' } });
    expect(events).toBe(1);
  });

  it('đăng nhập đúng sau một lần khoá tạm đặt lại bậc khoá về 0', async () => {
    for (let i = 0; i < 5; i++) await wrong().catch(() => undefined);
    await expireTemporaryLock();
    await right();
    const user = await privileged.userAccount.findUniqueOrThrow({ where: { id: userAId } });
    expect(user).toMatchObject({ lockoutLevel: 0, failedLoginCount: 0, lockedUntil: null, lockedPermanentlyAt: null });
  });

  it('tài khoản is_active=false → AccountDisabledError', async () => {
    await privileged.userAccount.update({ where: { id: userAId }, data: { isActive: false } });
    await expect(
      authService.login({ tenantId: tenantAId, username: usernameA, password: TEST_PASSWORD }, REQUEST_META),
    ).rejects.toBeInstanceOf(AccountDisabledError);
  });

  it('đúng username/password nhưng sai tenantId → coi như sai thông tin đăng nhập (RLS chặn xuyên tenant)', async () => {
    await expect(
      authService.login({ tenantId: tenantBId, username: usernameA, password: TEST_PASSWORD }, REQUEST_META),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('refresh xoay vòng: dùng lại refresh token cũ bị phát hiện reuse, thu hồi toàn bộ phiên', async () => {
    const login = await authService.login(
      { tenantId: tenantAId, username: usernameA, password: TEST_PASSWORD },
      REQUEST_META,
    );
    const oldRefreshToken = login.refreshToken;

    const refreshed = await authService.refresh(oldRefreshToken, REQUEST_META);
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(oldRefreshToken);

    await expect(authService.refresh(oldRefreshToken, REQUEST_META)).rejects.toBeInstanceOf(
      RefreshTokenReuseDetectedError,
    );

    const sessions = await privileged.userSession.findMany({ where: { userId: userAId } });
    expect(sessions.every((s) => s.deletedAt !== null)).toBe(true);

    // phiên mới vừa rotate ra cũng đã bị revoke-all theo phản ứng reuse detection ở trên
    await expect(authService.refresh(refreshed.refreshToken, REQUEST_META)).rejects.toBeInstanceOf(
      RefreshTokenReuseDetectedError,
    );
  });

  it('logout thu hồi phiên; refresh bằng token đã logout bị từ chối', async () => {
    const login = await authService.login(
      { tenantId: tenantAId, username: usernameA, password: TEST_PASSWORD },
      REQUEST_META,
    );
    await authService.logout(login.refreshToken, REQUEST_META);

    const session = await privileged.userSession.findFirstOrThrow({ where: { userId: userAId } });
    expect(session.deletedAt).not.toBeNull();
    expect(session.deletedReason).toBe('logout');

    await expect(authService.refresh(login.refreshToken, REQUEST_META)).rejects.toBeInstanceOf(
      RefreshTokenReuseDetectedError,
    );
  });

  it('refresh với token rác/hỏng → RefreshTokenInvalidError', async () => {
    await expect(authService.refresh('not-a-real-jwt', REQUEST_META)).rejects.toBeInstanceOf(
      RefreshTokenInvalidError,
    );
  });

  it('logout không có cookie/token → không lỗi (idempotent)', async () => {
    await expect(authService.logout(undefined, REQUEST_META)).resolves.toBeUndefined();
  });

  it('getCurrentUser: trả đúng danh tính + vai trò + quyền thật (bug thu hồi quyền 2026-09-04)', async () => {
    const result = await authService.getCurrentUser(tenantAId, userAId);
    expect(result).toEqual({
      id: userAId,
      username: usernameA,
      fullName: 'Bác sĩ A',
      displayName: null,
      // Kho Thuốc GĐ4 (docs/DECISIONS.md #170) — Khoa/Phòng của actor, null cho tài khoản test
      // chưa gán Khoa/Phòng nào.
      departmentId: null,
      roles: ['doctor'],
      // Đúng khớp ma trận mặc định của vai trò 'doctor' — permissions không phải suy diễn ở web.
      permissions: DEFAULT_ROLE_PERMISSIONS.doctor,
      mustChangePassword: false,
      // Chi nhánh (docs/DECISIONS.md #231) — tenant test có đúng 1 chi nhánh mặc định → tài khoản tự thuộc chi nhánh đó.
      branches: [expect.objectContaining({ isDefault: true })],
      currentBranchId: expect.any(String),
      multiBranchCompany: false,
    });
  });

  it('getCurrentUser: tài khoản is_active=false → AccountDisabledError', async () => {
    await privileged.userAccount.update({ where: { id: userAId }, data: { isActive: false } });
    await expect(authService.getCurrentUser(tenantAId, userAId)).rejects.toBeInstanceOf(AccountDisabledError);
  });
});
