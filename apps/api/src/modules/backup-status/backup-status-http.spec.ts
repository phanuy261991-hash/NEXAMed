import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e cho `GET /api/v1/backup-status` (S6-01, ADM-04). Cùng khuôn 2 app instance như
 * `auth-login-http.spec.ts` (`COOKIE_SECURE override`) — env `BACKUP_STATUS_FILE` phải đặt TRƯỚC
 * lúc `ConfigModule` đọc, không đụng app dùng chung ở describe đầu (giả lập máy dev, không cấu
 * hình backup).
 */
describe('HTTP e2e — /api/v1/backup-status (chưa cấu hình, máy dev)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let receptionistToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: {
        tenantId,
        username,
        passwordHash,
        fullName: `User ${roleName}`,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });

    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

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

    fixture = await createTwoTenantFixture(privileged, 'Backup status e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/backup-status');
    expect(res.status).toBe(401);
  });

  it('vai trò không có clinic_config.read (receptionist) → 403 PERMISSION_DENIED', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/backup-status').set(authed(receptionistToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('clinic_admin, máy không cấu hình BACKUP_STATUS_FILE → configured:false, needsAttention:false (không báo giả trên máy dev)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/backup-status').set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      configured: false,
      lastRunAt: null,
      lastRunOk: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      lastError: null,
      needsAttention: false,
      reason: null,
    });
  });
});

describe('HTTP e2e — /api/v1/backup-status (đã cấu hình BACKUP_STATUS_FILE)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  let statusDir: string;
  let statusFile: string;
  const password = 'Test@12345';
  let clinicAdminToken: string;

  beforeAll(async () => {
    statusDir = await mkdtemp(join(tmpdir(), 'nexamed-backup-status-http-'));
    statusFile = join(statusDir, 'backup-status.json');
    process.env.BACKUP_STATUS_FILE = statusFile;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();
    fixture = await createTwoTenantFixture(privileged, 'Backup status configured e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);

    const username = `e2e-clinic_admin-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: {
        tenantId: fixture.tenantA.id,
        username,
        passwordHash,
        fullName: 'Admin backup status',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, name: 'clinic_admin' } });
    await privileged.userRole.create({
      data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password });
    clinicAdminToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    delete process.env.BACKUP_STATUS_FILE;
    await rm(statusDir, { recursive: true, force: true });
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it('đã cấu hình nhưng file chưa từng ghi (mới cài đặt) → configured:true, needsAttention:true, reason NEVER_RUN', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/backup-status').set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ configured: true, needsAttention: true, reason: 'NEVER_RUN' });
  });

  it('lần chạy gần nhất thất bại → needsAttention:true, reason LAST_RUN_FAILED', async () => {
    await writeFile(
      statusFile,
      JSON.stringify({
        lastRunAt: new Date().toISOString(),
        lastRunOk: false,
        lastSuccessAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        consecutiveFailures: 1,
        lastError: 'pg_dump: het dia',
      }),
    );
    const res = await request(app.getHttpServer()).get('/api/v1/backup-status').set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ configured: true, needsAttention: true, reason: 'LAST_RUN_FAILED', lastError: 'pg_dump: het dia' });
  });

  it('lần thành công gần nhất đã hơn 30 giờ → needsAttention:true, reason STALE', async () => {
    const staleAt = new Date(Date.now() - 31 * 60 * 60 * 1000).toISOString();
    await writeFile(
      statusFile,
      JSON.stringify({ lastRunAt: staleAt, lastRunOk: true, lastSuccessAt: staleAt, consecutiveFailures: 0, lastError: null }),
    );
    const res = await request(app.getHttpServer()).get('/api/v1/backup-status').set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ configured: true, needsAttention: true, reason: 'STALE' });
  });

  it('thành công gần đây → needsAttention:false', async () => {
    const now = new Date().toISOString();
    await writeFile(statusFile, JSON.stringify({ lastRunAt: now, lastRunOk: true, lastSuccessAt: now, consecutiveFailures: 0, lastError: null }));
    const res = await request(app.getHttpServer()).get('/api/v1/backup-status').set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ configured: true, needsAttention: false, reason: null });
  });
});
