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
 * HTTP e2e cho "Ví tạm ứng" (Patient Advance-Payment Wallet) — nạp/xem/tất toán ví, tách khỏi luồng
 * đụng invoice thật (`billing-http.spec.ts` phủ pay-with-wallet/topup-and-pay-with-wallet/refund/
 * revert-payment). Cùng khuôn `cash-account-http.spec.ts`.
 */
describe('HTTP e2e — /api/v1/wallet', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let clinicAdminToken: string;
  let doctorToken: string;
  let tenantBClinicAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-wallet-${roleName}-${randomUUID()}`;
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

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  async function createPatient(token: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(token))
      .send({ fullName: 'Bệnh nhân e2e ví', dob: '1990-01-01', gender: 'female', phone: '0933555666', nationalId: randomNationalId() });
    return res.body.data.id as string;
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

    fixture = await createTwoTenantFixture(privileged, 'PatientWallet e2e');
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
    const res = await request(app.getHttpServer()).post('/api/v1/wallet/topup');
    expect(res.status).toBe(401);
  });

  it('bác sĩ (không có patient_wallet.topup) → 403 khi nạp tạm ứng', async () => {
    const patientId = await createPatient(receptionistToken);
    const res = await request(app.getHttpServer()).post('/api/v1/wallet/topup').set(authed(doctorToken)).send({ patientId, amount: 100_000, paymentMethodCode: 'CASH' });
    expect(res.status).toBe(403);
  });

  it('bệnh nhân chưa từng có ví → GET /wallet trả null', async () => {
    const patientId = await createPatient(receptionistToken);
    const res = await request(app.getHttpServer()).get('/api/v1/wallet').set(authed(receptionistToken)).query({ patientId });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('nạp tạm ứng lần đầu → tự tạo ví, số dư đúng, trả kèm voucherNo để in phiếu', async () => {
    const patientId = await createPatient(receptionistToken);

    const res = await request(app.getHttpServer())
      .post('/api/v1/wallet/topup')
      .set(authed(receptionistToken))
      .send({ patientId, amount: 5_000_000, paymentMethodCode: 'CASH', note: 'Tạm ứng đợt điều trị' });
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.balance).toBe(5_000_000);
    expect(res.body.data.wallet.status).toBe('ACTIVE');
    expect(res.body.data.voucherNo).toMatch(/^PTU/);

    const wallet = await request(app.getHttpServer()).get('/api/v1/wallet').set(authed(receptionistToken)).query({ patientId });
    expect(wallet.body.data.balance).toBe(5_000_000);
    expect(wallet.body.data.totalToppedUp).toBe(5_000_000);
    expect(wallet.body.data.totalUsed).toBe(0);
  });

  it('nạp 2 lần cộng dồn đúng, lịch sử giao dịch hiện đủ 2 dòng TOPUP mới nhất trước', async () => {
    const patientId = await createPatient(receptionistToken);
    const first = await request(app.getHttpServer()).post('/api/v1/wallet/topup').set(authed(receptionistToken)).send({ patientId, amount: 1_000_000, paymentMethodCode: 'CASH' });
    expect(first.status).toBe(200);
    const second = await request(app.getHttpServer()).post('/api/v1/wallet/topup').set(authed(receptionistToken)).send({ patientId, amount: 2_000_000, paymentMethodCode: 'CASH' });
    expect(second.status).toBe(200);

    const wallet = await request(app.getHttpServer()).get('/api/v1/wallet').set(authed(receptionistToken)).query({ patientId });
    expect(wallet.body.data.balance).toBe(3_000_000);
    expect(wallet.body.data.topUpCount).toBe(2);
    expect(wallet.body.data.deductCount).toBe(0);

    const tx = await request(app.getHttpServer()).get('/api/v1/wallet/transactions').set(authed(receptionistToken)).query({ patientId });
    expect(tx.status).toBe(200);
    expect(tx.body.data.items).toHaveLength(2);
    expect(tx.body.data.items[0]).toMatchObject({ type: 'TOPUP', amount: 2_000_000, balanceAfter: 3_000_000 });
    expect(tx.body.data.items[0].voucherNo).toMatch(/^PTU/);
    expect(tx.body.data.items[1]).toMatchObject({ type: 'TOPUP', amount: 1_000_000, balanceAfter: 1_000_000 });
  });

  it('nạp bằng phương thức không phải tiền mặt khi tenant chưa có quỹ ngân hàng nào → 400 (cash_voucher.cashAccountId bắt buộc)', async () => {
    const patientId = await createPatient(receptionistToken);
    const res = await request(app.getHttpServer())
      .post('/api/v1/wallet/topup')
      .set(authed(receptionistToken))
      .send({ patientId, amount: 200_000, paymentMethodCode: 'BANK_TRANSFER' });
    expect(res.status).toBe(400);
  });

  it('tất toán còn số dư mà thiếu phương thức hoàn tiền → 400', async () => {
    const patientId = await createPatient(receptionistToken);
    await request(app.getHttpServer()).post('/api/v1/wallet/topup').set(authed(receptionistToken)).send({ patientId, amount: 500_000, paymentMethodCode: 'CASH' });

    const res = await request(app.getHttpServer()).post('/api/v1/wallet/settle').set(authed(clinicAdminToken)).send({ patientId });
    expect(res.status).toBe(400);
  });

  it('lễ tân (không có patient_wallet.settle) → 403 khi tất toán', async () => {
    const patientId = await createPatient(receptionistToken);
    await request(app.getHttpServer()).post('/api/v1/wallet/topup').set(authed(receptionistToken)).send({ patientId, amount: 500_000, paymentMethodCode: 'CASH' });

    const res = await request(app.getHttpServer())
      .post('/api/v1/wallet/settle')
      .set(authed(receptionistToken))
      .send({ patientId, paymentMethodCode: 'CASH' });
    expect(res.status).toBe(403);
  });

  it('tất toán hợp lệ → hoàn đúng số dư, khoá ví, sinh phiếu chi PCU; nạp/tất toán lại đều 409 WALLET_CLOSED', async () => {
    const patientId = await createPatient(receptionistToken);
    await request(app.getHttpServer()).post('/api/v1/wallet/topup').set(authed(receptionistToken)).send({ patientId, amount: 1_500_000, paymentMethodCode: 'CASH' });

    const res = await request(app.getHttpServer())
      .post('/api/v1/wallet/settle')
      .set(authed(clinicAdminToken))
      .send({ patientId, paymentMethodCode: 'CASH' });
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.balance).toBe(0);
    expect(res.body.data.wallet.status).toBe('CLOSED');
    expect(res.body.data.voucherNo).toMatch(/^PCU/);

    const topUpAfter = await request(app.getHttpServer())
      .post('/api/v1/wallet/topup')
      .set(authed(receptionistToken))
      .send({ patientId, amount: 100_000, paymentMethodCode: 'CASH' });
    expect(topUpAfter.status).toBe(409);
    expect(topUpAfter.body.error.code).toBe('WALLET_CLOSED');

    const settleAgain = await request(app.getHttpServer()).post('/api/v1/wallet/settle').set(authed(clinicAdminToken)).send({ patientId });
    expect(settleAgain.status).toBe(409);
    expect(settleAgain.body.error.code).toBe('WALLET_CLOSED');
  });

  it('tất toán ví chưa từng tồn tại → 404', async () => {
    const patientId = await createPatient(receptionistToken);
    const res = await request(app.getHttpServer()).post('/api/v1/wallet/settle').set(authed(clinicAdminToken)).send({ patientId });
    expect(res.status).toBe(404);
  });

  it('trang "Ví tạm ứng" tổng hợp — clinic_admin thấy đúng ví vừa tạo, lễ tân 403', async () => {
    const patientId = await createPatient(receptionistToken);
    await request(app.getHttpServer()).post('/api/v1/wallet/topup').set(authed(receptionistToken)).send({ patientId, amount: 750_000, paymentMethodCode: 'CASH' });

    const forbidden = await request(app.getHttpServer()).get('/api/v1/wallet/list').set(authed(receptionistToken));
    expect(forbidden.status).toBe(403);

    const res = await request(app.getHttpServer()).get('/api/v1/wallet/list').set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    const item = (res.body.data.items as Array<{ patientId: string; balance: number }>).find((i) => i.patientId === patientId);
    expect(item).toMatchObject({ balance: 750_000 });
    expect(res.body.data.totalHeldBalance).toBeGreaterThanOrEqual(750_000);
    expect(res.body.data.activeWalletCount).toBeGreaterThanOrEqual(1);
  });

  it('cách ly tenant — tenant B (clinic_admin, có patient_wallet.settle) không thấy ví của bệnh nhân tenant A', async () => {
    const patientId = await createPatient(receptionistToken);
    await request(app.getHttpServer()).post('/api/v1/wallet/topup').set(authed(receptionistToken)).send({ patientId, amount: 300_000, paymentMethodCode: 'CASH' });

    const res = await request(app.getHttpServer()).get('/api/v1/wallet').set(authed(tenantBClinicAdminToken)).query({ patientId });
    // Không tìm thấy bệnh nhân/ví thuộc tenant khác → coi như chưa từng có ví (null), không lộ dữ liệu.
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();

    const list = await request(app.getHttpServer()).get('/api/v1/wallet/list').set(authed(tenantBClinicAdminToken));
    const found = (list.body.data.items as Array<{ patientId: string }>).find((i) => i.patientId === patientId);
    expect(found).toBeUndefined();
  });
});
