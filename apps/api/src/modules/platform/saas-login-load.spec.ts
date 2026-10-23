import { randomUUID } from 'node:crypto';
import { cpus } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { TenantDirectoryRepository } from '../tenant-context/tenant-directory.repository';
import { AuthService } from '../iam/auth.service';
import { TokenService } from '../iam/token.service';
import { SessionRepository } from '../iam/session.repository';
import { UserAccountAuthRepository } from '../iam/user-account-auth.repository';
import { BranchAccessService } from '../iam/branch-access.service';
import { DeviceTrustService } from '../iam/device-trust.service';
import { BranchRepository } from '../iam/branch.repository';

/**
 * Tải đăng nhập ở chế độ SaaS (docs/DECISIONS.md #237 + #244): NHIỀU công ty dùng CHUNG một tiến trình API và CHUNG một bể kết nối Postgres.
 * Kịch bản thật: đầu giờ sáng, mỗi phòng khám 30-50 nhân viên mở máy gần như cùng lúc. Nếu một thao tác chậm (băm mật khẩu) giữ kết nối thì
 * công ty này làm sập đăng nhập của công ty khác — đúng loại sự cố "hàng xóm ồn ào" của SaaS. Test ép bể kết nối nhỏ để lộ lỗi trên mọi máy.
 */
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const TEST_PASSWORD = 'Test@12345';
const REQUEST_META = { ip: '127.0.0.1', userAgent: 'vitest' };
const POOL_LIMIT = 5;
const COMPANIES = 8;
const USERS_PER_COMPANY = 40;
/**
 * Test TẢI, KHÔNG chạy trong `pnpm test` mặc định: 320 lượt đăng nhập đồng thời ăn hết bể kết nối trong vài giây và làm các spec chạy song song đỏ oan
 * (đã gặp thật 21/10/2026 với `prescription-submission-http.spec.ts`). Chạy thủ công khi cần đo: `RUN_LOAD_TESTS=1 npx vitest run src/modules/platform/saas-login-load.spec.ts`.
 * Chốt chặn hồi quy cho lỗi "băm mật khẩu trong transaction" nằm ở `auth-concurrency.spec.ts` (nhẹ, chạy cùng bộ test thường).
 */
const ENABLED = process.env.RUN_LOAD_TESTS === '1';

function fakeConfigService(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === 'JWT_SECRET') return process.env.JWT_SECRET as string;
      throw new Error(`Không có config key "${key}" trong test`);
    },
  } as unknown as ConfigService;
}

function smallPoolUrl(): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.searchParams.set('connection_limit', String(POOL_LIMIT));
  url.searchParams.set('pool_timeout', '10');
  return url.toString();
}

describe.skipIf(!ENABLED)(`SaaS — ${COMPANIES} công ty × ${USERS_PER_COMPANY} tài khoản đăng nhập cùng lúc`, () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService({ datasources: { db: { url: smallPoolUrl() } } });
  const unitOfWork = new UnitOfWorkService(appPrisma);
  const authService = new AuthService(
    unitOfWork,
    new UserAccountAuthRepository(),
    new SessionRepository(),
    new TokenService(new JwtService({}), fakeConfigService()),
    new BranchAccessService(new BranchRepository()),
    new DeviceTrustService(fakeConfigService() as never), new TenantDirectoryRepository(appPrisma),
  );

  const tenantIds: string[] = [];
  /** `[tenantId, username]` của mọi tài khoản trong mọi công ty. */
  const logins: Array<[string, string]> = [];

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();
    await seedPermissionCatalog(privileged);
    const passwordHash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });

    for (let c = 0; c < COMPANIES; c += 1) {
      const tenant = await privileged.tenant.create({ data: { name: `SaaS load ${c} ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR } });
      tenantIds.push(tenant.id);
      await seedDefaultRolesForTenant(privileged, tenant.id, SYSTEM_ACTOR);
      const role = await privileged.role.findFirstOrThrow({ where: { tenantId: tenant.id, name: 'receptionist' } });
      for (let u = 0; u < USERS_PER_COMPANY; u += 1) {
        const username = `nv-${c}-${u}-${randomUUID().slice(0, 8)}`;
        const user = await privileged.userAccount.create({
          data: { tenantId: tenant.id, username, passwordHash, fullName: `Nhân viên ${c}-${u}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
        });
        await privileged.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: role.id, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR } });
        logins.push([tenant.id, username]);
      }
    }
  }, 900_000);

  afterAll(async () => {
    const where = { tenantId: { in: tenantIds } };
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
    await privileged.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await appPrisma.$disconnect();
    await privileged.$disconnect();
  }, 300_000);

  it(`${COMPANIES * USERS_PER_COMPANY} lượt đăng nhập đồng thời (bể ${POOL_LIMIT} kết nối): không lỗi, và không công ty nào bị công ty khác làm hỏng`, async () => {
    const started = Date.now();
    const results = await Promise.allSettled(logins.map(([tenantId, username]) => authService.login({ tenantId, username, password: TEST_PASSWORD }, REQUEST_META)));
    const elapsed = Date.now() - started;

    const failuresByTenant = new Map<string, number>();
    const messages = new Set<string>();
    results.forEach((r, i) => {
      if (r.status !== 'rejected') return;
      const tenantId = logins[i]![0];
      failuresByTenant.set(tenantId, (failuresByTenant.get(tenantId) ?? 0) + 1);
      messages.add(String((r.reason as Error).message).slice(0, 160));
    });
    const failed = results.filter((r) => r.status === 'rejected').length;
    console.log(
      `[SaaS] ${COMPANIES} công ty × ${USERS_PER_COMPANY} người = ${logins.length} lượt / bể ${POOL_LIMIT} kết nối / ${cpus().length} CPU → ${elapsed} ms` +
        `, lỗi: ${failed}${failed > 0 ? ` · số công ty bị ảnh hưởng: ${failuresByTenant.size}/${COMPANIES} · ${[...messages].join(' | ')}` : ''}`,
    );
    expect([...messages]).toEqual([]);
    expect(failed).toBe(0);
  }, 900_000);
});
