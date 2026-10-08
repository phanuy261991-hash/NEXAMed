import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — `/api/v1/backup-config` (cấu hình sao lưu dữ liệu từ giao diện, docs/DECISIONS.md #217). Cùng khuôn 2 app instance như `backup-status-http.spec.ts`: env
 * `BACKUP_STATUS_FILE` phải đặt TRƯỚC lúc `ConfigModule` đọc, nên mỗi trường hợp (máy dev không cấu hình / máy on-prem có container sao lưu) là một describe riêng.
 */
async function bootstrap(label: string) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());
  await app.init();
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  await privileged.$connect();
  const fixture = await createTwoTenantFixture(privileged, label);
  await seedPermissionCatalog(privileged);
  await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
  const password = 'Test@12345';
  const tokenFor = async (roleName: string) => {
    const username = `e2e-backupcfg-${roleName}-${randomUUID()}`;
    const user = await privileged.userAccount.create({
      data: { tenantId: fixture.tenantA.id, username, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, name: roleName } });
    await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password });
    return login.body.data.accessToken as string;
  };
  return { app, privileged, fixture, tokenFor };
}
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('HTTP e2e — /api/v1/backup-config (máy dev, không có container sao lưu)', () => {
  let ctx: Awaited<ReturnType<typeof bootstrap>>;
  let adminToken: string;

  beforeAll(async () => {
    delete process.env.BACKUP_STATUS_FILE;
    ctx = await bootstrap('Backup config dev e2e');
    adminToken = await ctx.tokenFor('clinic_admin');
  });
  afterAll(async () => {
    await ctx.fixture.cleanup();
    await ctx.privileged.$disconnect();
    await ctx.app.close();
  });

  it('không khả dụng: available=false (giao diện ẩn mục này), mọi thao tác ghi bị từ chối 409', async () => {
    const get = await request(ctx.app.getHttpServer()).get('/api/v1/backup-config').set(authed(adminToken));
    expect(get.status).toBe(200);
    expect(get.body.data.available).toBe(false);
    expect(get.body.data.status.configured).toBe(false);
    const put = await request(ctx.app.getHttpServer()).put('/api/v1/backup-config').set(authed(adminToken)).send({ enabled: true, hourVn: 2, retentionDays: 14 });
    expect(put.status).toBe(409);
    expect(put.body.error.code).toBe('BACKUP_NOT_AVAILABLE');
    expect((await request(ctx.app.getHttpServer()).post('/api/v1/backup-config/run-now').set(authed(adminToken))).status).toBe(409);
  });
});

describe('HTTP e2e — /api/v1/backup-config (máy on-prem, có container sao lưu)', () => {
  let ctx: Awaited<ReturnType<typeof bootstrap>>;
  let dir: string;
  let adminToken: string;
  let doctorToken: string;
  let receptionistToken: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexamed-backup-config-http-'));
    process.env.BACKUP_STATUS_FILE = join(dir, 'backup-status.json');
    process.env.BACKUP_HOST_DIR_DISPLAY = 'D:\\NEXAMed-backup';
    ctx = await bootstrap('Backup config on-prem e2e');
    adminToken = await ctx.tokenFor('clinic_admin');
    doctorToken = await ctx.tokenFor('doctor');
    receptionistToken = await ctx.tokenFor('receptionist');
  });
  afterAll(async () => {
    delete process.env.BACKUP_STATUS_FILE;
    delete process.env.BACKUP_HOST_DIR_DISPLAY;
    await rm(dir, { recursive: true, force: true });
    await ctx.fixture.cleanup();
    await ctx.privileged.$disconnect();
    await ctx.app.close();
  });

  const api = '/api/v1/backup-config';

  it('phân quyền: không token 401; bác sĩ/lễ tân 403 (cả xem lẫn sửa); quản lý phòng khám được', async () => {
    expect((await request(ctx.app.getHttpServer()).get(api)).status).toBe(401);
    for (const token of [doctorToken, receptionistToken]) {
      expect((await request(ctx.app.getHttpServer()).get(api).set(authed(token))).status).toBe(403);
      expect((await request(ctx.app.getHttpServer()).put(api).set(authed(token)).send({ enabled: true, hourVn: 2, retentionDays: 14 })).status).toBe(403);
      expect((await request(ctx.app.getHttpServer()).post(`${api}/run-now`).set(authed(token))).status).toBe(403);
    }
    expect((await request(ctx.app.getHttpServer()).get(api).set(authed(adminToken))).status).toBe(200);
  });

  it('chưa có file cấu hình (container chưa chạy) → trả mặc định + thư mục đích hiển thị; sửa → ghi file thật, đọc lại đúng, có audit trước/sau', async () => {
    const first = await request(ctx.app.getHttpServer()).get(api).set(authed(adminToken));
    expect(first.body.data).toMatchObject({ available: true, config: { enabled: true, hourVn: 9, retentionDays: 14 }, destinationDir: 'D:\\NEXAMed-backup', runRequestedAt: null });
    // Chưa có lần sao lưu nào → trạng thái kèm sẵn báo cần chú ý (NEVER_RUN) để màn cấu hình hiện cảnh báo, kể cả với người chỉ có quyền system_backup.read.
    expect(first.body.data.status).toMatchObject({ configured: true, lastRunAt: null, needsAttention: true, reason: 'NEVER_RUN' });

    const updated = await request(ctx.app.getHttpServer()).put(api).set(authed(adminToken)).send({ enabled: false, hourVn: 23, retentionDays: 30 });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.config).toEqual({ enabled: false, hourVn: 23, retentionDays: 30 });
    expect(JSON.parse(await readFile(join(dir, 'backup-config.json'), 'utf-8'))).toEqual({ enabled: false, hourVn: 23, retentionDays: 30 });

    const audit = await ctx.privileged.auditLog.findFirst({ where: { tenantId: ctx.fixture.tenantA.id, action: 'system_backup.config_updated' }, orderBy: { id: 'desc' } });
    expect(audit?.beforeJson).toEqual({ enabled: true, hourVn: 9, retentionDays: 14 });
    expect(audit?.afterJson).toEqual({ enabled: false, hourVn: 23, retentionDays: 30 });
  });

  it('kiểm tra dữ liệu: giờ ngoài 0-23, số ngày giữ < 1 hoặc > 365 → 400 và không ghi gì', async () => {
    for (const bad of [{ enabled: true, hourVn: 24, retentionDays: 14 }, { enabled: true, hourVn: -1, retentionDays: 14 }, { enabled: true, hourVn: 2, retentionDays: 0 }, { enabled: true, hourVn: 2, retentionDays: 366 }, { enabled: 'yes', hourVn: 2, retentionDays: 14 }]) {
      expect((await request(ctx.app.getHttpServer()).put(api).set(authed(adminToken)).send(bad)).status).toBe(400);
    }
    expect(JSON.parse(await readFile(join(dir, 'backup-config.json'), 'utf-8'))).toEqual({ enabled: false, hourVn: 23, retentionDays: 30 });
  });

  it('"Sao lưu ngay": tạo cờ cho container, trả mốc yêu cầu, GET thấy đang chờ; xoá cờ (container đã nhận) thì hết chờ; có audit', async () => {
    const res = await request(ctx.app.getHttpServer()).post(`${api}/run-now`).set(authed(adminToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await expect(stat(join(dir, 'backup-run-now'))).resolves.toBeDefined();
    const waiting = await request(ctx.app.getHttpServer()).get(api).set(authed(adminToken));
    expect(waiting.body.data.runRequestedAt).toBe(res.body.data.requestedAt);
    await rm(join(dir, 'backup-run-now'));
    expect((await request(ctx.app.getHttpServer()).get(api).set(authed(adminToken))).body.data.runRequestedAt).toBeNull();
    const audit = await ctx.privileged.auditLog.findFirst({ where: { tenantId: ctx.fixture.tenantA.id, action: 'system_backup.run_requested' } });
    expect(audit).not.toBeNull();
  });
});
