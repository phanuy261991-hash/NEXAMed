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
import { DashboardService } from './dashboard.service';

/**
 * HTTP e2e — Trang Tổng quan của BÁC SĨ (`GET /reports/dashboard/doctor`, docs/DECISIONS.md #286). Dữ liệu dựng bằng Prisma đặc quyền với mốc giờ Việt Nam cố định; các con số kiểm bằng cách gọi
 * `DashboardService` với `now` = 14:30 để không phụ thuộc đồng hồ thật. HTTP kiểm phân quyền, công tắc hiện tiền và cô lập công ty. Trọng tâm: CHỈ lượt khám của chính bác sĩ, chi nhánh đang làm việc,
 * hàng chờ chung đúng Khoa, kết quả chưa xem, hẹn tái khám của riêng mình, tiền sau chiết khấu chỉ khi bật công tắc.
 */
describe('HTTP e2e — Trang Tổng quan bác sĩ (/api/v1/reports/dashboard/doctor)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let doctorToken: string;
  let adminToken: string;
  let receptionistToken: string;
  let tenantBDoctorToken: string;
  let branchA: string;
  let branchB: string;
  let departmentId: string;
  let d1Id: string;
  let d2Id: string;
  let tenantBDoctorId: string;
  let tenantBBranch: string;
  const enc: Record<string, string> = {};

  const today = getVietnamDateString();
  const ago = (days: number) => addDaysToDateString(today, -days)!;
  const at = (date: string, hhmm: string): Date => {
    const [hh, mm] = hhmm.split(':').map(Number);
    return new Date(vietnamDayStartUtc(date).getTime() + ((hh ?? 0) * 60 + (mm ?? 0)) * 60_000);
  };
  const NOW = at(today, '14:30');

  async function makePatient(tag: string, dob = '1990-01-01'): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patient = await privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode: `BN-BS-${tag}-${n}`, fullName: `Bệnh nhân ${tag}`, dob: new Date(dob), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return patient.id;
  }

  async function makeEncounter(
    key: string,
    status: 'CHECKED_IN' | 'IN_CONSULTATION' | 'COMPLETED' | 'CANCELLED',
    checkedIn: { date?: string; hhmm: string },
    opts: { doctorId?: string | null; branchId?: string; started?: string; completed?: string; patientName?: string } = {},
  ) {
    const patientId = await makePatient(opts.patientName ?? key);
    const date = checkedIn.date ?? today;
    const e = await privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: opts.branchId ?? branchA,
        patientId,
        doctorId: opts.doctorId === undefined ? d1Id : opts.doctorId,
        departmentId,
        encounterNo: `LK-BS-${randomUUID().slice(0, 10)}`,
        status,
        checkedInAt: at(date, checkedIn.hhmm),
        startedAt: opts.started ? at(date, opts.started) : null,
        completedAt: opts.completed ? at(date, opts.completed) : null,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    enc[key] = e.id;
    return e;
  }

  async function makeResultItem(encounterId: string, name: string, opts: { seen?: boolean; status?: 'COMPLETED' | 'ORDERED' } = {}) {
    const service = await privileged.technicalService.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id } });
    // Mỗi lượt khám chỉ có MỘT phiếu chỉ định (unique tenant + encounter): dùng lại nếu đã có.
    const order =
      (await privileged.clinicalOrder.findFirst({ where: { tenantId: fixture.tenantA.id, encounterId } })) ??
      (await privileged.clinicalOrder.create({ data: { tenantId: fixture.tenantA.id, orderNo: `PCD-BS-${randomUUID().slice(0, 8)}`, encounterId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } }));
    return privileged.clinicalOrderItem.create({
      data: {
        tenantId: fixture.tenantA.id,
        clinicalOrderId: order.id,
        itemKind: 'TECHNICAL_SERVICE',
        technicalServiceId: service.id,
        name,
        performance: 'IN_HOUSE',
        unitPrice: 100_000n,
        priceTypeCode: 'THUONG',
        unitCode: 'LUOT',
        status: opts.status ?? 'COMPLETED',
        doctorSeenAt: opts.seen ? new Date() : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  async function makeInvoice(encounterId: string, status: 'UNPAID' | 'PAID' | 'CANCELLED', total: number, discountPercent?: number) {
    const invoice = await privileged.invoice.create({
      data: {
        tenantId: fixture.tenantA.id,
        encounterId,
        invoiceNo: `PT-BS-${randomUUID().slice(0, 10)}`,
        status,
        totalAmount: BigInt(total),
        discountType: discountPercent ? 'PERCENT' : null,
        discountValue: discountPercent ? BigInt(discountPercent) : null,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const item = await privileged.encounterServiceItem.create({
      data: { tenantId: fixture.tenantA.id, encounterId, examTypeCode: 'KHAM', examTypeName: 'Khám', examTypePrice: BigInt(total), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.invoiceLine.create({
      data: { tenantId: fixture.tenantA.id, invoiceId: invoice.id, sourceServiceItemId: item.id, examTypeCode: 'KHAM', examTypeName: 'Khám', unitPrice: BigInt(total), quantity: 1, lineTotal: BigInt(total), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return invoice;
  }

  const getDoctor = (token: string) => http().get('/api/v1/reports/dashboard/doctor').set(authed(token));
  const viaService = (userId: string, branchId = branchA, tenantId = fixture.tenantA.id) => app.get(DashboardService, { strict: false }).getDoctorDashboard({ tenantId, branchId, userId }, NOW);
  const setMoney = (enabled: boolean) => http().patch('/api/v1/clinic-settings').set(authed(adminToken)).send({ doctorDashboardMoneyEnabled: enabled });

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

    fixture = await createTwoTenantFixture(privileged, 'Dashboard doctor e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    tenantBBranch = await getDefaultBranchId(privileged, fixture.tenantB.id);
    branchB = (await privileged.branch.create({ data: { tenantId: fixture.tenantA.id, code: 'ZZBS2', name: 'Chi nhánh B bác sĩ', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } })).id;
    departmentId = (await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } })).id;

    const doctor1 = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'bs-doc1', [branchA]);
    const doctor2 = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'bs-doc2', [branchA]);
    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'bs-admin', [branchA]);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'bs-recep', [branchA]);
    const doctorB = await h.createUser(fixture.tenantB.id, { name: 'doctor' }, 'bs-docB');
    d1Id = doctor1.id;
    d2Id = doctor2.id;
    tenantBDoctorId = doctorB.id;
    // Bác sĩ 1 thuộc Khoa mặc định (để "Nhận ca" từ hàng chờ chung của Khoa đó).
    await privileged.userAccount.updateMany({ where: { tenantId: fixture.tenantA.id, id: d1Id }, data: { departmentId } });
    doctorToken = await h.login(fixture.tenantA.id, doctor1.username);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    tenantBDoctorToken = await h.login(fixture.tenantB.id, doctorB.username);

    // Một dịch vụ kỹ thuật để gắn kết quả.
    await privileged.technicalService.create({ data: { tenantId: fixture.tenantA.id, code: 'XN-BS', name: 'Xét nghiệm thử', serviceKind: 'LAB', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });

    // Lượt khám hôm nay của bác sĩ 1: 2 đã xong (10 và 12 phút), 1 đang khám, 2 đang chờ, 1 huỷ (không tính).
    await makeEncounter('Done1', 'COMPLETED', { hhmm: '07:10' }, { started: '07:15', completed: '07:25' });
    await makeEncounter('Done2', 'COMPLETED', { hhmm: '08:00' }, { started: '08:05', completed: '08:17' });
    await makeEncounter('InProg', 'IN_CONSULTATION', { hhmm: '14:00' }, { started: '14:20', patientName: 'Nguyen Lan' });
    await makeEncounter('Wait1', 'CHECKED_IN', { hhmm: '14:16' }, { patientName: 'Do Mai' });
    await makeEncounter('Wait2', 'CHECKED_IN', { hhmm: '14:25' });
    await makeEncounter('Cancelled', 'CANCELLED', { hhmm: '09:00' });
    // Không phải của bác sĩ 1 / chi nhánh khác: không được tính.
    await makeEncounter('D2Wait', 'CHECKED_IN', { hhmm: '14:00' }, { doctorId: d2Id });
    await makeEncounter('D2Done', 'COMPLETED', { hhmm: '09:00' }, { doctorId: d2Id, started: '09:05', completed: '09:20' });
    await makeEncounter('BranchB', 'CHECKED_IN', { hhmm: '14:00' }, { branchId: branchB });
    // Hàng chờ chung của Khoa (chưa có bác sĩ): 2 lượt chi nhánh A; 1 lượt chi nhánh B không tính.
    await makeEncounter('Pool1', 'CHECKED_IN', { hhmm: '14:05' }, { doctorId: null });
    await makeEncounter('Pool2', 'CHECKED_IN', { hhmm: '14:10' }, { doctorId: null });
    await makeEncounter('PoolB', 'CHECKED_IN', { hhmm: '14:10' }, { doctorId: null, branchId: branchB });
    // Các ngày trước (để tính trung bình mỗi ngày CÓ khám): hôm qua 3 lượt, 3 ngày trước 1 lượt → trung bình 2.
    for (const k of ['Y1', 'Y2', 'Y3']) await makeEncounter(k, 'COMPLETED', { date: ago(1), hhmm: '09:00' }, { started: '09:05', completed: '09:15' });
    await makeEncounter('Old1', 'COMPLETED', { date: ago(3), hhmm: '09:00' }, { started: '09:05', completed: '09:15' });

    // Kết quả chưa xem: 2 của bác sĩ 1 (một ở lượt đang khám, một ở lượt đã xong hôm qua); loại: đã xem, chưa có kết quả, của bác sĩ 2.
    await makeResultItem(enc.InProg!, 'Công thức máu');
    await makeResultItem(enc.Y1!, 'Đường huyết lúc đói');
    await makeResultItem(enc.InProg!, 'Đã xem rồi', { seen: true });
    await makeResultItem(enc.InProg!, 'Chưa có kết quả', { status: 'ORDERED' });
    await makeResultItem(enc.D2Done!, 'Của bác sĩ khác');

    // Hẹn tái khám đến hạn hôm nay: 1 của bác sĩ 1, 1 của bác sĩ 2 (không tính).
    const plan = (encounterId: string) =>
      privileged.encounterTreatmentPlan.create({
        data: { tenantId: fixture.tenantA.id, encounterId, directions: ['FOLLOW_UP'], followUpDate: new Date(today), signedAt: new Date(), signedBy: SYSTEM_TEST_ACTOR, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    await plan(enc.Done1!);
    await plan(enc.D2Done!);

    // Phiếu thu: 180.000 (200.000 giảm 10%, chưa thu) + 100.000 (đã thu) của bác sĩ 1 = 280.000; loại: phiếu huỷ, của bác sĩ 2, chi nhánh B.
    await makeInvoice(enc.Done1!, 'UNPAID', 200_000, 10);
    await makeInvoice(enc.Done2!, 'PAID', 100_000);
    await makeInvoice(enc.InProg!, 'CANCELLED', 999_000);
    await makeInvoice(enc.D2Done!, 'PAID', 500_000);
    await makeInvoice(enc.BranchB!, 'PAID', 700_000);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('phân quyền', () => {
    it('chưa đăng nhập → 401; bác sĩ → 200; quản trị và lễ tân (không có dashboard.doctor) → 403', async () => {
      expect((await http().get('/api/v1/reports/dashboard/doctor')).status).toBe(401);
      expect((await getDoctor(doctorToken)).status).toBe(200);
      expect((await getDoctor(adminToken)).status).toBe(403);
      expect((await getDoctor(receptionistToken)).status).toBe(403);
    });

    it('phản hồi đủ hình dạng: 24 giờ, không có số tiền khi chưa bật công tắc', async () => {
      const res = await getDoctor(doctorToken);
      expect(res.body.data.hourly).toHaveLength(24);
      expect(res.body.data.revenue).toBeNull();
      expect(res.body.data.date).toBe(today);
    });
  });

  describe('số liệu (chỉ của chính bác sĩ, chi nhánh đang làm việc)', () => {
    it('đếm theo trạng thái: tổng 5 (2 xong + 1 đang khám + 2 chờ); lượt huỷ, của bác sĩ khác, chi nhánh khác không tính', async () => {
      const d = await viaService(d1Id);
      expect(d.total.count).toBe(5);
      expect(d.waiting.count).toBe(2);
      expect(d.inProgress.count).toBe(1);
      expect(d.done.count).toBe(2);
    });

    it('người chờ lâu nhất 14 phút, danh sách chờ lâu nhất đứng đầu; đang khám 10 phút; khám trung bình 11 phút', async () => {
      const d = await viaService(d1Id);
      expect(d.waiting.longestWaitMinutes).toBe(14);
      expect(d.waitingList.items.map((i) => i.patientName)).toEqual(['Bệnh nhân Do Mai', 'Bệnh nhân Wait2']);
      expect(d.waitingList.items[0]).toMatchObject({ waitMinutes: 14, age: expect.any(Number) });
      expect(d.waitingList.moreCount).toBe(0);
      expect(d.inProgress).toMatchObject({ patientName: 'Bệnh nhân Nguyen Lan', minutes: 10 });
      expect(d.done.averageMinutes).toBe(11);
    });

    it('trung bình mỗi ngày CÓ khám trong 7 ngày trước = 2 (hôm qua 3, ba ngày trước 1; ngày nghỉ không tính)', async () => {
      expect((await viaService(d1Id)).total.averagePerDay).toBe(2);
    });

    it('theo giờ: đủ 24 giờ, đếm theo giờ nhận (07 giờ 1, 08 giờ 1, 14 giờ 3)', async () => {
      const { hourly } = await viaService(d1Id);
      expect(hourly[7]!.count).toBe(1);
      expect(hourly[8]!.count).toBe(1);
      expect(hourly[14]!.count).toBe(3);
      expect(hourly.reduce((s, x) => s + x.count, 0)).toBe(5);
    });

    it('hàng chờ chung của Khoa: 2 lượt chưa có bác sĩ ở chi nhánh này (lượt chi nhánh khác không tính)', async () => {
      expect((await viaService(d1Id)).commonQueue.count).toBe(2);
    });

    it('bác sĩ chưa gán Khoa → hàng chờ chung 0', async () => {
      expect((await viaService(d2Id)).commonQueue.count).toBe(0);
    });

    it('kết quả chưa xem: 2 (đã xem, chưa có kết quả, của bác sĩ khác bị loại), mới nhất trước', async () => {
      const d = await viaService(d1Id);
      expect(d.unseenResults.count).toBe(2);
      expect(d.unseenResults.moreCount).toBe(0);
      expect(d.unseenResults.items.map((i) => i.name).sort()).toEqual(['Công thức máu', 'Đường huyết lúc đói']);
      expect(d.unseenResults.items.every((i) => typeof i.patientName === 'string' && i.resultedAt.length > 10)).toBe(true);
    });

    it('hẹn tái khám chỉ của lượt khám bác sĩ này khám (1), không lẫn của bác sĩ khác', async () => {
      const d = await viaService(d1Id);
      expect(d.followUp).toMatchObject({ dueToday: 1, arrivedToday: 0, overdueNotArrived: 0 });
      expect((await viaService(d2Id)).followUp.dueToday).toBe(1);
    });

    it('bác sĩ 2 chỉ thấy lượt của mình (1 chờ, 1 xong)', async () => {
      const d = await viaService(d2Id);
      expect(d.total.count).toBe(2);
      expect(d.waiting.count).toBe(1);
      expect(d.done.count).toBe(1);
    });

    it('chi nhánh khác: bác sĩ 1 ở chi nhánh B chỉ thấy lượt của chi nhánh B (1 chờ)', async () => {
      const d = await viaService(d1Id, branchB);
      expect(d.total.count).toBe(1);
      expect(d.waiting.count).toBe(1);
      expect(d.done.count).toBe(0);
    });
  });

  describe('công tắc "Hiện doanh thu sinh ra trên Tổng quan bác sĩ"', () => {
    it('chỉ quản trị bật/tắt được (bác sĩ → 403)', async () => {
      const denied = await http().patch('/api/v1/clinic-settings').set(authed(doctorToken)).send({ doctorDashboardMoneyEnabled: true });
      expect(denied.status).toBe(403);
    });

    it('mặc định TẮT: không gửi số tiền (revenue = null)', async () => {
      expect((await http().get('/api/v1/clinic-settings').set(authed(adminToken))).body.data.doctorDashboardMoneyEnabled).toBe(false);
      expect((await viaService(d1Id)).revenue).toBeNull();
    });

    it('BẬT: doanh thu = tiền sau chiết khấu của phiếu chưa thu + đã thu của bác sĩ này (280.000); phiếu huỷ, của bác sĩ khác, chi nhánh khác không tính; TẮT lại thì ẩn', async () => {
      try {
        expect((await setMoney(true)).status).toBe(200);
        expect((await viaService(d1Id)).revenue).toEqual({ amount: 280_000 });
        expect((await getDoctor(doctorToken)).body.data.revenue).toEqual({ amount: 280_000 });
        expect((await viaService(d2Id)).revenue).toEqual({ amount: 500_000 });
      } finally {
        expect((await setMoney(false)).status).toBe(200);
      }
      expect((await getDoctor(doctorToken)).body.data.revenue).toBeNull();
    });
  });

  describe('cô lập công ty', () => {
    it('bác sĩ công ty khác thấy toàn số 0 (không thấy lượt/tiền của công ty này) và công tắc của công ty này không ảnh hưởng', async () => {
      try {
        expect((await setMoney(true)).status).toBe(200);
        const res = await getDoctor(tenantBDoctorToken);
        expect(res.status).toBe(200);
        expect(res.body.data.total.count).toBe(0);
        expect(res.body.data.waiting).toEqual({ count: 0, longestWaitMinutes: null });
        expect(res.body.data.unseenResults.count).toBe(0);
        expect(res.body.data.revenue).toBeNull();
      } finally {
        await setMoney(false);
      }
      // Dùng đúng mã bác sĩ của công ty A trong công ty B cũng không ra dữ liệu.
      const cross = await viaService(d1Id, tenantBBranch, fixture.tenantB.id);
      expect(cross.total.count).toBe(0);
      expect(tenantBDoctorId).not.toBe(d1Id);
    });
  });
});
