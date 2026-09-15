import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * S6-03 (rà soát bảo mật) — xác nhận thật `patient-lookup` throttler (50/phút/IP, `iam.module.ts`)
 * có hiệu lực trên `GET /patients` — trước đây 4 endpoint tra cứu bệnh nhân hoàn toàn không có
 * rate limit nào (`.claude/docs/security-audit.md` mục "Ràng buộc khi viết code"). TÁCH RIÊNG file
 * (app instance + bucket throttle riêng) khỏi `patient-http.spec.ts`, cùng lý do
 * `user-account-hr-profile-http.spec.ts` đã tách khỏi `user-account-http.spec.ts` — bắn 51 request
 * liên tiếp vào cùng bucket sẽ đụng ngưỡng của MỌI test khác trong cùng file/app instance nếu gộp
 * chung.
 */
describe('HTTP e2e — /api/v1/patients (rate limit patient-lookup)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  let receptionistToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();

    fixture = await createTwoTenantFixture(privileged, 'Patient rate-limit e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);

    const password = 'Test@12345';
    const username = `e2e-receptionist-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: {
        tenantId: fixture.tenantA.id,
        username,
        passwordHash,
        fullName: 'User receptionist',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, name: 'receptionist' } });
    await privileged.userRole.create({
      data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantId: fixture.tenantA.id, username, password });
    receptionistToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it('51 lệnh gọi liên tiếp GET /patients → 50 đầu tiên đi qua (200), lệnh thứ 51 bị chặn 429', async () => {
    const results: number[] = [];
    for (let i = 0; i < 51; i += 1) {
      const res = await request(app.getHttpServer()).get('/api/v1/patients').set(authed(receptionistToken));
      results.push(res.status);
    }
    const okCount = results.filter((s) => s === 200).length;
    const throttledCount = results.filter((s) => s === 429).length;
    expect(okCount).toBe(50);
    expect(throttledCount).toBe(1);
    expect(results[50]).toBe(429);
  }, 30_000);
});
