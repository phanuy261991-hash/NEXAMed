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
 * HTTP e2e cho "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — Quỹ (`cash_account`). Cùng khuôn
 * `cashier-shift-http.spec.ts`. `seedDefaultRolesForTenant` đã tự tạo 1 quỹ tiền mặt mặc định
 * ("Quỹ tiền mặt", `isDefault=true`) cho mỗi tenant — dùng thẳng thay vì tạo lại.
 */
describe('HTTP e2e — /api/v1/cash-accounts', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let clinicAdminToken: string;
  let doctorToken: string;
  let tenantBClinicAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-cash-account-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
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

    fixture = await createTwoTenantFixture(privileged, 'CashAccount e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    doctorToken = (await createUserWithRole(fixture.tenantA.id, 'doctor')).token;
    tenantBClinicAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/cash-accounts');
    expect(res.status).toBe(401);
  });

  it('bác sĩ (không có quyền cash_account) → 403', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(doctorToken));
    expect(res.status).toBe(403);
  });

  it('GET list → thấy đúng quỹ tiền mặt mặc định seed sẵn ("Quỹ tiền mặt", isDefault=true, mã QU...)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(receptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    const account = res.body.data.items[0];
    expect(account.name).toBe('Quỹ tiền mặt');
    expect(account.type).toBe('CASH');
    expect(account.isDefault).toBe(true);
    expect(account.code).toMatch(/^QU/);
  });

  it('receptionist không có cash_account.manage → tạo quỹ mới bị 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cash-accounts')
      .set(authed(receptionistToken))
      .send({ name: 'Quỹ thử', type: 'CASH', openingBalance: 0, openingBalanceAt: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  it('clinic_admin tạo quỹ ngân hàng thiếu số tài khoản → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cash-accounts')
      .set(authed(clinicAdminToken))
      .send({ name: 'Tài khoản VCB', type: 'BANK', openingBalance: 0, openingBalanceAt: new Date().toISOString() });
    expect(res.status).toBe(400);
  });

  it('clinic_admin tạo quỹ ngân hàng đủ thông tin → 200, không phải mặc định', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cash-accounts')
      .set(authed(clinicAdminToken))
      .send({
        name: 'Tài khoản VCB',
        type: 'BANK',
        bankName: 'Vietcombank',
        bankAccountNo: '0071000123456',
        openingBalance: 10_000_000,
        openingBalanceAt: new Date().toISOString(),
      });
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('BANK');
    expect(res.body.data.isDefault).toBe(false);
    expect(res.body.data.code).toMatch(/^QU/);
  });

  it('đặt quỹ ngân hàng vừa tạo làm mặc định → quỹ tiền mặt cũ tự bỏ cờ mặc định (mỗi loại đúng 1 mặc định)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/cash-accounts')
      .set(authed(clinicAdminToken))
      .send({
        name: 'Tài khoản ACB',
        type: 'BANK',
        bankName: 'ACB',
        bankAccountNo: '999888777',
        openingBalance: 0,
        openingBalanceAt: new Date().toISOString(),
        isDefault: true,
      });
    expect(createRes.status).toBe(200);
    expect(createRes.body.data.isDefault).toBe(true);

    const listRes = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(receptionistToken));
    const bankAccounts = listRes.body.data.items.filter((a: { type: string }) => a.type === 'BANK');
    const defaults = bankAccounts.filter((a: { isDefault: boolean }) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('Tài khoản ACB');
  });

  it('sửa quỹ với version cũ → 409 CONCURRENT_MODIFICATION', async () => {
    const listRes = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(clinicAdminToken));
    const cash = listRes.body.data.items.find((a: { type: string }) => a.type === 'CASH');
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/cash-accounts/${cash.id}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'Quỹ tiền mặt (đổi tên)', version: 999 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
  });

  it('sửa quỹ đúng version → 200, đổi tên/ẩn thành công', async () => {
    const listRes = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(clinicAdminToken));
    const cash = listRes.body.data.items.find((a: { type: string }) => a.type === 'CASH');
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/cash-accounts/${cash.id}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'Quỹ tiền mặt chính', isActive: false, version: cash.version });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Quỹ tiền mặt chính');
    expect(res.body.data.isActive).toBe(false);
    expect(res.body.data.version).toBe(cash.version + 1);

    // Khôi phục lại để không ảnh hưởng test khác chạy sau trong cùng tenant (đặc biệt các test billing/cashier-shift dùng chung quỹ mặc định).
    const restore = await request(app.getHttpServer())
      .patch(`/api/v1/cash-accounts/${cash.id}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'Quỹ tiền mặt', isActive: true, version: cash.version + 1 });
    expect(restore.status).toBe(200);
  });

  it('sửa quỹ không tồn tại → 404', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/cash-accounts/${randomUUID()}`)
      .set(authed(clinicAdminToken))
      .send({ name: 'x', version: 1 });
    expect(res.status).toBe(404);
  });

  it('cách ly tenant: clinic_admin tenant B chỉ thấy đúng 1 quỹ mặc định của tenant B, không thấy quỹ tenant A', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(tenantBClinicAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].name).toBe('Quỹ tiền mặt');
  });

  it('cách ly tenant: sửa quỹ của tenant A bằng token tenant B → 404 (không phải 403)', async () => {
    const listRes = await request(app.getHttpServer()).get('/api/v1/cash-accounts').set(authed(clinicAdminToken));
    const cash = listRes.body.data.items.find((a: { type: string }) => a.type === 'CASH');
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/cash-accounts/${cash.id}`)
      .set(authed(tenantBClinicAdminToken))
      .send({ name: 'Đổi trộm', version: cash.version });
    expect(res.status).toBe(404);
  });
});
