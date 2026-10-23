import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { EXPIRED_SESSION_RETENTION_DAYS, MAX_ACTIVE_SESSIONS_PER_USER, REFRESH_TOKEN_TTL_SECONDS } from '@nexamed/core';
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
import { DeviceTrustService } from './device-trust.service';
import { BranchRepository } from './branch.repository';
import { purgeExpiredSessionsForAllTenants } from './expired-session-purge';

/**
 * Giữ sạch bảng `user_session` (docs/DECISIONS.md #244): giới hạn số phiên mỗi tài khoản + job nền dọn phiên hết hạn.
 * Không có hai thứ này thì bảng phình vô hạn (mỗi 15 phút một dòng cho mỗi người đang làm việc) và làm chậm dần chính việc gia hạn phiên.
 */
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

describe('Phiên đăng nhập — giới hạn số phiên và dọn phiên hết hạn', () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService();
  const unitOfWork = new UnitOfWorkService(appPrisma);
  const sessionRepository = new SessionRepository();
  const authService = new AuthService(
    unitOfWork,
    new UserAccountAuthRepository(),
    sessionRepository,
    new TokenService(new JwtService({}), fakeConfigService()),
    new BranchAccessService(new BranchRepository()),
    new DeviceTrustService(fakeConfigService() as never), new TenantDirectoryRepository(appPrisma),
  );

  let tenantId: string;
  let userId: string;
  const username = `phien-${randomUUID()}`;

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();
    const tenant = await privileged.tenant.create({ data: { name: `Session hygiene ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR } });
    tenantId = tenant.id;
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, tenantId, SYSTEM_ACTOR);
    const user = await privileged.userAccount.create({
      data: {
        tenantId,
        username,
        passwordHash: await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id }),
        fullName: 'Nhân viên thử phiên',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });
    userId = user.id;
  }, 120_000);

  afterAll(async () => {
    const where = { tenantId };
    await privileged.auditLog.deleteMany({ where });
    await privileged.userSession.deleteMany({ where });
    await privileged.userRole.deleteMany({ where });
    await privileged.rolePermission.deleteMany({ where });
    await privileged.role.deleteMany({ where });
    await privileged.userAccount.deleteMany({ where });
    await privileged.department.deleteMany({ where });
    await privileged.cashAccount.deleteMany({ where });
    await privileged.warehouse.deleteMany({ where });
    await privileged.codeSequence.deleteMany({ where });
    await privileged.referenceCatalog.deleteMany({ where });
    await privileged.userBranch.deleteMany({ where });
    await privileged.branch.deleteMany({ where });
    await privileged.tenant.delete({ where: { id: tenantId } });
    await appPrisma.$disconnect();
    await privileged.$disconnect();
  }, 120_000);

  it(`đăng nhập ${MAX_ACTIVE_SESSIONS_PER_USER + 3} lần: chỉ giữ ${MAX_ACTIVE_SESSIONS_PER_USER} phiên mới nhất, phiên cũ nhất bị thu hồi với lý do rõ ràng`, async () => {
    for (let i = 0; i < MAX_ACTIVE_SESSIONS_PER_USER + 3; i += 1) {
      await authService.login({ tenantId, username, password: TEST_PASSWORD }, REQUEST_META);
    }
    const active = await privileged.userSession.findMany({ where: { tenantId, userId, deletedAt: null }, orderBy: { issuedAt: 'asc' } });
    expect(active).toHaveLength(MAX_ACTIVE_SESSIONS_PER_USER);
    const revoked = await privileged.userSession.findMany({ where: { tenantId, userId, deletedAt: { not: null } } });
    expect(revoked).toHaveLength(3);
    expect(new Set(revoked.map((s) => s.deletedReason))).toEqual(new Set(['session_limit']));
    // Phiên bị thu hồi phải là những phiên CŨ nhất.
    const oldestActive = active[0]!.issuedAt.getTime();
    expect(revoked.every((s) => s.issuedAt.getTime() <= oldestActive)).toBe(true);
  }, 120_000);

  it('refresh token mặc định 7 ngày (không còn 30 ngày)', () => {
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it(`job dọn chỉ xoá phiên đã hết hạn quá ${EXPIRED_SESSION_RETENTION_DAYS} ngày; phiên còn hiệu lực và phiên vừa hết hạn vẫn giữ`, async () => {
    const now = Date.now();
    const make = async (expiresAt: Date, hash: string) =>
      privileged.userSession.create({
        data: { tenantId, userId, refreshTokenHash: hash, issuedAt: new Date(expiresAt.getTime() - 1000), expiresAt, createdBy: userId, updatedBy: userId },
      });
    const cuRat = await make(new Date(now - (EXPIRED_SESSION_RETENTION_DAYS + 2) * 86_400_000), `cu-rat-${randomUUID()}`);
    const vuaHetHan = await make(new Date(now - 60_000), `vua-het-han-${randomUUID()}`);
    const conHieuLuc = await make(new Date(now + 86_400_000), `con-hieu-luc-${randomUUID()}`);

    const deleted = await purgeExpiredSessionsForAllTenants(privileged, unitOfWork, sessionRepository);
    expect(deleted).toBeGreaterThanOrEqual(1);

    expect(await privileged.userSession.findUnique({ where: { id: cuRat.id } })).toBeNull();
    expect(await privileged.userSession.findUnique({ where: { id: vuaHetHan.id } })).not.toBeNull();
    expect(await privileged.userSession.findUnique({ where: { id: conHieuLuc.id } })).not.toBeNull();
  }, 120_000);
});
