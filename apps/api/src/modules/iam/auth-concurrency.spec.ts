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
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { SessionRepository } from './session.repository';
import { UserAccountAuthRepository } from './user-account-auth.repository';
import { BranchAccessService } from './branch-access.service';
import { BranchRepository } from './branch.repository';

/**
 * Nhiều người đăng nhập CÙNG LÚC (phòng khám đông: đầu ca cả trăm người mở máy một lượt) — chốt chặn hồi quy cho lỗi thật phát hiện 21/10/2026 khi đo tải:
 * `argon2.verify` (~100-300 ms, tốn RAM) từng chạy BÊN TRONG transaction của `runInTenantScope`, nên mỗi lượt đăng nhập GIỮ một kết nối Postgres suốt thời gian băm mật khẩu.
 * Bể kết nối của Prisma nhỏ (mặc định `số CPU × 2 + 1`, máy chủ phòng khám thường 2-4 CPU) nên chỉ vài chục người đăng nhập đồng thời đã cạn bể → Prisma ném lỗi hết giờ
 * chờ kết nối/transaction → HTTP 500 hàng loạt. Test này ép bể kết nối nhỏ để tái hiện trên MỌI máy (máy phát triển nhiều CPU sẽ không lộ lỗi).
 */
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const TEST_PASSWORD = 'Test@12345';
const REQUEST_META = { ip: '127.0.0.1', userAgent: 'vitest' };
/**
 * Bể kết nối + thời gian chờ cố ý NHỎ để lỗi lộ ra với ít người, test chạy nhanh và không ăn hết tài nguyên của các spec chạy song song.
 * Đã kiểm thật: với mã CŨ (băm mật khẩu bên trong transaction) cấu hình này làm phần lớn lượt đăng nhập đỏ; với mã đã sửa thì không lượt nào lỗi.
 * Kịch bản "cả phòng khám/nhiều công ty đăng nhập cùng lúc" (100-320 lượt) nằm ở `saas-login-load.spec.ts`, chạy thủ công bằng `RUN_LOAD_TESTS=1`.
 */
const POOL_LIMIT = 3;
const POOL_TIMEOUT_SECONDS = 2;
const CONCURRENT_LOGINS = 30;

function fakeConfigService(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === 'JWT_SECRET') return process.env.JWT_SECRET as string;
      throw new Error(`Không có config key "${key}" trong test`);
    },
  } as unknown as ConfigService;
}

/** `DATABASE_URL` của ứng dụng + giới hạn bể kết nối (giữ nguyên tham số sẵn có). */
function smallPoolUrl(): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.searchParams.set('connection_limit', String(POOL_LIMIT));
  url.searchParams.set('pool_timeout', String(POOL_TIMEOUT_SECONDS));
  return url.toString();
}

describe('AuthService — nhiều người đăng nhập đồng thời (bể kết nối nhỏ)', () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService({ datasources: { db: { url: smallPoolUrl() } } });
  const unitOfWork = new UnitOfWorkService(appPrisma);
  const authService = new AuthService(
    unitOfWork,
    new UserAccountAuthRepository(),
    new SessionRepository(),
    new TokenService(new JwtService({}), fakeConfigService()),
    new BranchAccessService(new BranchRepository()),
    new TenantDirectoryRepository(appPrisma),
  );

  let tenantId: string;
  const usernames: string[] = [];

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();
    const tenant = await privileged.tenant.create({ data: { name: `Auth concurrency ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR } });
    tenantId = tenant.id;
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, tenantId, SYSTEM_ACTOR);
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: 'receptionist' } });

    // Cùng một hash cho mọi tài khoản (băm một lần cho nhanh) — việc verify vẫn tốn đúng chừng ấy công sức mỗi lượt đăng nhập.
    const passwordHash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });
    for (let i = 0; i < CONCURRENT_LOGINS; i += 1) {
      const username = `concurrent-${i}-${randomUUID()}`;
      usernames.push(username);
      const user = await privileged.userAccount.create({
        data: { tenantId, username, passwordHash, fullName: `Nhân viên ${i}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
      });
      await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR } });
    }
  }, 120_000);

  afterAll(async () => {
    await privileged.auditLog.deleteMany({ where: { tenantId } });
    await privileged.userSession.deleteMany({ where: { tenantId } });
    await privileged.userRole.deleteMany({ where: { tenantId } });
    await privileged.rolePermission.deleteMany({ where: { tenantId } });
    await privileged.role.deleteMany({ where: { tenantId } });
    await privileged.userAccount.deleteMany({ where: { tenantId } });
    await privileged.department.deleteMany({ where: { tenantId } });
    await privileged.cashAccount.deleteMany({ where: { tenantId } });
    await privileged.warehouse.deleteMany({ where: { tenantId } });
    await privileged.codeSequence.deleteMany({ where: { tenantId } });
    await privileged.referenceCatalog.deleteMany({ where: { tenantId } });
    await privileged.userBranch.deleteMany({ where: { tenantId } });
    await privileged.branch.deleteMany({ where: { tenantId } });
    await privileged.tenant.delete({ where: { id: tenantId } });
    await appPrisma.$disconnect();
    await privileged.$disconnect();
  }, 120_000);

  it(`${CONCURRENT_LOGINS} người đăng nhập cùng lúc với bể ${POOL_LIMIT} kết nối: không lỗi nào, không ai bị hết giờ chờ kết nối`, async () => {
    const started = Date.now();
    const results = await Promise.allSettled(
      usernames.map((username) => authService.login({ tenantId, username, password: TEST_PASSWORD }, REQUEST_META)),
    );
    const elapsed = Date.now() - started;
    const failures = results.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error).message).slice(0, 200)] : []));
    // In ra để lần chạy nào cũng thấy số thật (máy khác nhau tốc độ khác nhau).
    console.log(`[đăng nhập đồng thời] ${CONCURRENT_LOGINS} người / bể ${POOL_LIMIT} kết nối / ${cpus().length} CPU → ${elapsed} ms, lỗi: ${failures.length}`);
    expect(failures).toEqual([]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  }, 180_000);

  it('sai mật khẩu đồng loạt (ví dụ sau khi đổi mật khẩu hàng loạt) cũng không làm cạn bể kết nối', async () => {
    const results = await Promise.allSettled(
      usernames.map((username) => authService.login({ tenantId, username, password: 'Sai@12345' }, REQUEST_META)),
    );
    // Mọi lượt phải trả lỗi NGHIỆP VỤ (sai thông tin đăng nhập), không phải lỗi hạ tầng (hết giờ chờ kết nối/transaction).
    const infraFailures = results.flatMap((r) => {
      if (r.status !== 'rejected') return [];
      const message = String((r.reason as Error).message);
      return /pool|timed out|timeout|transaction/i.test(message) ? [message.slice(0, 200)] : [];
    });
    expect(infraFailures).toEqual([]);
  }, 180_000);
});
