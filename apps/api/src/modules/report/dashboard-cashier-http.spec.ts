import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { addDaysToDateString, getVietnamDateString, vietnamDayStartUtc } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — Trang Tổng quan của THU NGÂN (`GET /reports/dashboard/cashier`, docs/DECISIONS.md #283). Dữ liệu dựng bằng Prisma đặc quyền với MỐC GIỜ VIỆT NAM cố định, đọc lại qua HTTP.
 * Trọng tâm: tiền đã thu/đã hoàn/thực thu theo NGÀY THU, thu theo phương thức và theo giờ, phiếu chờ thu SAU chiết khấu (có tóm tắt dịch vụ, danh sách cắt ở 8 phiếu),
 * cô lập CHI NHÁNH và CÔNG TY, và phân quyền (`dashboard.cashier` mặc định chỉ lễ tân/thu ngân).
 */
describe('HTTP e2e — Trang Tổng quan thu ngân (/api/v1/reports/dashboard/cashier)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let receptionistToken: string;
  let adminToken: string;
  let doctorToken: string;
  let tenantBReceptionistToken: string;
  let branchA: string;
  let branchB: string;

  const today = getVietnamDateString();
  const yesterday = addDaysToDateString(today, -1)!;
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };

  async function makeEncounter(tag: string, checkedInAt: Date, branchId = branchA): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patient = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode: `BN-TN-${tag}-${n}`, fullName: `Bệnh nhân thu ngân ${tag}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    const encounter = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId,
        patientId: patient.id,
        departmentId: department.id,
        encounterNo: `LK-TN-${randomUUID().slice(0, 10)}`,
        status: 'CHECKED_IN',
        checkedInAt,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return encounter.id;
  }

  /** Phiếu thu với các dòng dịch vụ khám (mỗi tên một dòng, chia đều `total`) và các dòng thanh toán. */
  async function makeInvoice(
    encounterId: string,
    opts: { status: 'UNPAID' | 'PAID'; total: number; lineNames?: string[]; discountPercent?: number; payments?: Array<{ type: 'PAYMENT' | 'REFUND'; method: string; amount: number; paidAt: Date }> },
  ) {
    const invoice = await privileged.invoice.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId,
        invoiceNo: `PT-TN-${randomUUID().slice(0, 10)}`,
        status: opts.status,
        totalAmount: BigInt(opts.total),
        discountType: opts.discountPercent ? 'PERCENT' : null,
        discountValue: opts.discountPercent ? BigInt(opts.discountPercent) : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const names = opts.lineNames ?? [];
    for (const name of names) {
      const lineTotal = Math.round(opts.total / names.length);
      const item = await privileged.encounterServiceItem.create({
        data: { tenantId: fixture.tenantA.id, encounterId, examTypeCode: 'KHAM', examTypeName: name, examTypePrice: BigInt(lineTotal), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
      await privileged.invoiceLine.create({
        data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, sourceServiceItemId: item.id, examTypeCode: 'KHAM', examTypeName: name, unitPrice: BigInt(lineTotal), quantity: 1, lineTotal: BigInt(lineTotal), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    for (const p of opts.payments ?? []) {
      await privileged.payment.create({
        data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, method: p.method, type: p.type, amount: BigInt(p.amount), paidAt: p.paidAt, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    return invoice;
  }

  const getCashier = (token: string) => http().get('/api/v1/reports/dashboard/cashier').set(authed(token));

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

    fixture = await createTwoTenantFixture(privileged, 'Dashboard cashier e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZTN2', name: 'Chi nhánh B thu ngân', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;

    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'tn-recep', [branchA]);
    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'tn-admin', [branchA]);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'tn-doctor', [branchA]);
    const receptionistB = await h.createUser(fixture.tenantB.id, { name: 'receptionist' }, 'tn-recepB');
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    tenantBReceptionistToken = await h.login(fixture.tenantB.id, receptionistB.username);

    // Hôm qua: có thu và có phiếu chưa thu — KHÔNG được lọt vào số hôm nay.
    const eOld = await makeEncounter('old', at(yesterday, '09:00'));
    await makeInvoice(eOld, { status: 'PAID', total: 100_000, lineNames: ['Khám hôm qua'], payments: [{ type: 'PAYMENT', method: 'CASH', amount: 100_000, paidAt: at(yesterday, '09:30') }] });
    const eOldUnpaid = await makeEncounter('oldu', at(yesterday, '16:00'));
    await makeInvoice(eOldUnpaid, { status: 'UNPAID', total: 77_000, lineNames: ['Khám hôm qua chưa thu'] });

    // Hôm nay, đã thu: A (tiền mặt 300.000 lúc 09:30, hoàn 50.000 lúc 11:00), B (chuyển khoản 200.000 lúc 09:50), C (ví 100.000 lúc 14:20).
    const eA = await makeEncounter('a', at(today, '09:00'));
    await makeInvoice(eA, {
      status: 'PAID',
      total: 300_000,
      lineNames: ['Khám nội'],
      payments: [
        { type: 'PAYMENT', method: 'CASH', amount: 300_000, paidAt: at(today, '09:30') },
        { type: 'REFUND', method: 'CASH', amount: 50_000, paidAt: at(today, '11:00') },
      ],
    });
    const eB = await makeEncounter('b', at(today, '09:20'));
    await makeInvoice(eB, { status: 'PAID', total: 200_000, lineNames: ['Khám nhi'], payments: [{ type: 'PAYMENT', method: 'TRANSFER', amount: 200_000, paidAt: at(today, '09:50') }] });
    const eC = await makeEncounter('c', at(today, '13:00'));
    await makeInvoice(eC, { status: 'PAID', total: 100_000, lineNames: ['Khám sản'], payments: [{ type: 'PAYMENT', method: 'WALLET', amount: 100_000, paidAt: at(today, '14:20') }] });

    // Hôm nay, chưa thu: U1 (3 dịch vụ, giảm 10% → 540.000, tiếp nhận sớm nhất), U2 (200.000), cùng 8 phiếu nhỏ → tổng 10 phiếu.
    const u1 = await makeEncounter('u1', at(today, '08:00'));
    await makeInvoice(u1, { status: 'UNPAID', total: 600_000, lineNames: ['Khám nội', 'Công thức máu', 'Siêu âm'], discountPercent: 10 });
    const u2 = await makeEncounter('u2', at(today, '08:30'));
    await makeInvoice(u2, { status: 'UNPAID', total: 200_000, lineNames: ['Khám nhi'] });
    for (let i = 0; i < 8; i++) {
      const e = await makeEncounter(`un${i}`, at(today, `10:${String(10 + i).padStart(2, '0')}`));
      await makeInvoice(e, { status: 'UNPAID', total: 10_000, lineNames: ['Khám lẻ'] });
    }

    // Chi nhánh B của cùng công ty: KHÔNG được lọt vào số của chi nhánh A.
    const eB1 = await makeEncounter('bb', at(today, '10:00'), branchB);
    await makeInvoice(eB1, { status: 'PAID', total: 999_000, lineNames: ['Khám chi nhánh B'], payments: [{ type: 'PAYMENT', method: 'CASH', amount: 999_000, paidAt: at(today, '10:05') }] });
    const eB2 = await makeEncounter('bu', at(today, '10:30'), branchB);
    await makeInvoice(eB2, { status: 'UNPAID', total: 555_000, lineNames: ['Chờ thu chi nhánh B'] });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('chưa đăng nhập → 401; lễ tân (thu ngân chính) → 200; chủ phòng khám và bác sĩ (không có dashboard.cashier) → 403', async () => {
      expect((await http().get('/api/v1/reports/dashboard/cashier')).status).toBe(401);
      expect((await getCashier(receptionistToken)).status).toBe(200);
      expect((await getCashier(adminToken)).status).toBe(403);
      expect((await getCashier(doctorToken)).status).toBe(403);
    });
  });

  describe('tiền hôm nay', () => {
    it('đã thu, đã hoàn và thực thu theo NGÀY THU; không lẫn hôm qua và chi nhánh B', async () => {
      const res = await getCashier(receptionistToken);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = res.body.data;
      expect(d.date).toBe(today);
      expect(d.collected).toEqual({ invoiceCount: 3, amount: 600_000 });
      expect(d.refunded).toEqual({ invoiceCount: 1, amount: 50_000 });
      expect(d.net).toBe(550_000);
    });

    it('đã thu theo phương thức: sắp theo tiền giảm dần, tổng khớp ô Đã thu, hoàn tiền không có mặt', async () => {
      const d = (await getCashier(receptionistToken)).body.data;
      expect(d.byMethod.map((m: { methodCode: string; amount: number; paymentCount: number }) => [m.methodCode, m.amount, m.paymentCount])).toEqual([
        ['CASH', 300_000, 1],
        ['TRANSFER', 200_000, 1],
        ['WALLET', 100_000, 1],
      ]);
      expect(d.byMethod.every((m: { methodName: string }) => m.methodName.length > 0)).toBe(true);
      expect(d.byMethod.reduce((s: number, m: { amount: number }) => s + m.amount, 0)).toBe(d.collected.amount);
    });

    it('thực thu ròng theo giờ thu giờ VN, đủ 24 giờ, tổng khớp thực thu', async () => {
      const d = (await getCashier(receptionistToken)).body.data;
      expect(d.hourly).toHaveLength(24);
      const at = (hour: number) => d.hourly.find((x: { hour: number }) => x.hour === hour)?.amount;
      expect(at(9)).toBe(500_000);
      expect(at(11)).toBe(-50_000);
      expect(at(14)).toBe(100_000);
      expect(at(10)).toBe(0); // thu 999.000 của chi nhánh B lúc 10:05 không tính
      expect(d.hourly.reduce((s: number, x: { amount: number }) => s + x.amount, 0)).toBe(d.net);
    });
  });

  describe('phiếu chờ thu', () => {
    it('tiền SAU chiết khấu (600.000 giảm 10% = 540.000); không lẫn hôm qua và chi nhánh B', async () => {
      const d = (await getCashier(receptionistToken)).body.data;
      // 540.000 + 200.000 + 8 × 10.000
      expect(d.pending.invoiceCount).toBe(10);
      expect(d.pending.amount).toBe(820_000);
    });

    it('danh sách cắt ở 8 phiếu, cũ trước, kèm bệnh nhân và tóm tắt dịch vụ; moreCount = số còn lại', async () => {
      const d = (await getCashier(receptionistToken)).body.data;
      expect(d.pending.items).toHaveLength(8);
      expect(d.pending.moreCount).toBe(2);
      const [first, second] = d.pending.items;
      expect(first).toMatchObject({ patientName: 'Bệnh nhân thu ngân u1', summary: 'Khám nội, Công thức máu +1', dueAmount: 540_000, invoiceType: 'SERVICE' });
      expect(first.invoiceId).toBeTruthy();
      expect(first.encounterId).toBeTruthy();
      expect(first.invoiceNo).toMatch(/^PT-TN-/);
      expect(second).toMatchObject({ patientName: 'Bệnh nhân thu ngân u2', summary: 'Khám nhi', dueAmount: 200_000 });
    });
  });

  describe('cô lập công ty', () => {
    it('thu ngân công ty khác thấy số 0, không thấy dữ liệu của công ty này', async () => {
      const d = (await getCashier(tenantBReceptionistToken)).body.data;
      expect(d.collected).toEqual({ invoiceCount: 0, amount: 0 });
      expect(d.refunded).toEqual({ invoiceCount: 0, amount: 0 });
      expect(d.net).toBe(0);
      expect(d.pending).toEqual({ invoiceCount: 0, amount: 0, items: [], moreCount: 0 });
      expect(d.byMethod).toEqual([]);
    });
  });
});
