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
 * Giới hạn tần suất đăng nhập HAI LỚP (docs/DECISIONS.md #258, sửa #244): theo TÀI KHOẢN (10/phút, không phụ thuộc IP) và theo IP + công ty với trần RỘNG hơn
 * (đặt `LOGIN_IP_LIMIT_PER_MINUTE=12` cho test để bắn ít yêu cầu; mặc định thật: SaaS 30, một công ty 60). Mọi yêu cầu trong test cùng một IP (127.0.0.1) — đúng tình huống
 * "cả phòng khám dùng chung IP". Mỗi test dùng công ty RIÊNG (UUID ngẫu nhiên) nên bộ đếm không lẫn nhau. Tách file (app + bộ đếm riêng) để không đụng test khác.
 */
describe('HTTP e2e — giới hạn tần suất đăng nhập hai lớp (#258)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';
  const previousIpLimit = process.env.LOGIN_IP_LIMIT_PER_MINUTE;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-throttle-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return { userId: user.id as string, username };
  }

  const login = (tenantId: string, username: string, pw: string = password) => request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password: pw });

  beforeAll(async () => {
    process.env.LOGIN_IP_LIMIT_PER_MINUTE = '12';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();
    fixture = await createTwoTenantFixture(privileged, 'LoginThrottle e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
  });

  afterAll(async () => {
    if (previousIpLimit === undefined) delete process.env.LOGIN_IP_LIMIT_PER_MINUTE;
    else process.env.LOGIN_IP_LIMIT_PER_MINUTE = previousIpLimit;
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('theo TÀI KHOẢN: lần thứ 11 trong một phút cho CÙNG tên đăng nhập → 429, nhưng tên đăng nhập KHÁC cùng IP + công ty vẫn đi qua', async () => {
    const tenantId = randomUUID();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await login(tenantId, 'bs.ghost')).status);
    expect(statuses.slice(0, 10).every((s) => s === 401), JSON.stringify(statuses)).toBe(true);
    expect(statuses[10]).toBe(429);

    // Người khác (tên khác) cùng IP, cùng công ty: không bị liên luỵ.
    expect((await login(tenantId, 'ls.khac')).status).toBe(401);
  });

  it('tài khoản KHÔNG né được bằng cách đổi hoa/thường hay thêm khoảng trắng quanh tên đăng nhập', async () => {
    const tenantId = randomUUID();
    for (let i = 0; i < 10; i += 1) expect((await login(tenantId, 'BS.Same')).status).toBe(401);
    expect((await login(tenantId, '  bs.same ')).status).toBe(429);
  });

  it('theo IP + công ty: trần rộng hơn nhiều so với tài khoản — 12 tên đăng nhập KHÁC NHAU qua được, tên thứ 13 → 429 ("rải" mật khẩu bị chặn)', async () => {
    const tenantId = randomUUID();
    const statuses: number[] = [];
    for (let i = 0; i < 13; i += 1) statuses.push((await login(tenantId, `rai.${i}`)).status);
    expect(statuses.slice(0, 12).every((s) => s === 401), JSON.stringify(statuses)).toBe(true);
    expect(statuses[12]).toBe(429);
  });

  it('bộ đếm IP tách theo CÔNG TY: công ty khác cùng IP không bị liên luỵ khi một công ty chạm trần', async () => {
    const tenantFull = randomUUID();
    for (let i = 0; i < 13; i += 1) await login(tenantFull, `day.${i}`);
    expect((await login(tenantFull, 'day.moi')).status).toBe(429);
    expect((await login(randomUUID(), 'day.moi')).status).toBe(401);
  });

  it('NGƯỜI THẬT vẫn đăng nhập được khi một tên khác trong cùng công ty/IP đã bị chặn vì thử quá nhiều (không còn "một người làm cả phòng khám bị chặn")', async () => {
    const { username } = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    for (let i = 0; i < 11; i += 1) await login(fixture.tenantA.id, 'ke.dich');
    expect((await login(fixture.tenantA.id, 'ke.dich')).status).toBe(429);

    const ok = await login(fixture.tenantA.id, username);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
  });

  it('xin quyền khẩn cấp (break-glass) giới hạn theo NGƯỜI DÙNG: người này chạm 10/phút không làm người khác cùng IP + công ty bị chặn', async () => {
    const a = await createUserWithRole(fixture.tenantB.id, 'receptionist');
    const b = await createUserWithRole(fixture.tenantB.id, 'receptionist');
    const tokenA = (await login(fixture.tenantB.id, a.username)).body.data.accessToken as string;
    const tokenB = (await login(fixture.tenantB.id, b.username)).body.data.accessToken as string;
    const bg = (token: string) => request(app.getHttpServer()).post('/api/v1/break-glass').set({ Authorization: `Bearer ${token}` }).send({});

    // Thân rỗng → 400 (kiểm tra sau guard); vượt trần → 429 từ guard.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await bg(tokenA)).status);
    expect(statuses.slice(0, 10).every((s) => s === 400), JSON.stringify(statuses)).toBe(true);
    expect(statuses[10]).toBe(429);

    expect((await bg(tokenB)).status).toBe(400);
  });
});
