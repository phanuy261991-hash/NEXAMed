import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import {
  AccountDisabledError,
  AccountLockedError,
  DEFAULT_ROLE_PERMISSIONS,
  InvalidCredentialsError,
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
} from '@nexamed/core';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { SessionRepository } from './session.repository';
import { UserAccountAuthRepository } from './user-account-auth.repository';

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
  const authService = new AuthService(unitOfWork, userAccountAuthRepository, sessionRepository, tokenService);

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
    await privileged.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  beforeEach(async () => {
    await privileged.userAccount.update({
      where: { id: userAId },
      data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, isActive: true },
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

  it('sai mật khẩu 5 lần liên tiếp → khoá tài khoản; lần kế tiếp dù đúng mật khẩu vẫn bị chặn', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        authService.login({ tenantId: tenantAId, username: usernameA, password: 'wrong' }, REQUEST_META),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    const user = await privileged.userAccount.findUniqueOrThrow({ where: { id: userAId } });
    expect(user.failedLoginCount).toBe(5);
    expect(user.lockedUntil).not.toBeNull();

    await expect(
      authService.login({ tenantId: tenantAId, username: usernameA, password: TEST_PASSWORD }, REQUEST_META),
    ).rejects.toBeInstanceOf(AccountLockedError);
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
      roles: ['doctor'],
      // Đúng khớp ma trận mặc định của vai trò 'doctor' — permissions không phải suy diễn ở web.
      permissions: DEFAULT_ROLE_PERMISSIONS.doctor,
      mustChangePassword: false,
    });
  });

  it('getCurrentUser: tài khoản is_active=false → AccountDisabledError', async () => {
    await privileged.userAccount.update({ where: { id: userAId }, data: { isActive: false } });
    await expect(authService.getCurrentUser(tenantAId, userAId)).rejects.toBeInstanceOf(AccountDisabledError);
  });
});
