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
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — hai danh sách trong ngày ("Bệnh nhân trong ngày" `GET /reception/list` và "Thu ngân" `GET /billing/invoices`) tải THEO LÔ (docs/DECISIONS.md #251): con trỏ khoá,
 * lọc tab + tìm kiếm ở máy chủ trên cả ngày, số liệu cả ngày không đổi khi cuộn, tương thích ngược khi không truyền `limit`, cô lập tenant và chi nhánh.
 * Dữ liệu: 8 lượt khám ở chi nhánh A (đủ trạng thái chờ khám / đang khám / đã huỷ, đã thu / chưa thu), 2 lượt ở chi nhánh B, tenant B riêng.
 */
describe('HTTP e2e — danh sách trong ngày theo lô (tiếp nhận + thu ngân)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchB: string;
  let receptionistA: string;
  let doctorAToken: string;
  let doctorAId: string;
  let adminBToken: string;
  let doctorBId: string;
  let receptionistTenantB: string;
  let unpagedReception: Array<{ encounterId: string; fullName: string; status: string; invoiceStatus: string | null; checkedInAt: string }>;
  const tag = `PGT${randomUUID().slice(0, 6).toUpperCase()}`;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(tenantId: string, roleName: string, label: string, branchIds?: string[]) {
    const username = `e2e-pg-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    for (const branchId of branchIds ?? []) {
      await privileged.userBranch.create({ data: { tenantId, userId: user.id, branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    return { id: user.id as string, token: login.body.data.accessToken as string };
  }

  /** Tạo bệnh nhân + tiếp nhận trực tiếp (phiếu thu UNPAID 150.000 đ). */
  async function intake(token: string, doctorId: string, name: string, phone: string) {
    const patient = await http()
      .post('/api/v1/patients')
      .set(authed(token))
      .send({ fullName: name, dob: '1990-01-01', gender: 'female', phone, nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999) });
    expect(patient.status, JSON.stringify(patient.body)).toBe(200);
    const res = await http()
      .post('/api/v1/reception/direct')
      .set(authed(token))
      .send({
        patientId: patient.body.data.id,
        doctorId,
        checkedInAt: new Date().toISOString(),
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { encounterId: res.body.data.id as string, version: res.body.data.version as number };
  }

  const pay = (token: string, encounterId: string) => http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(token)).send({ method: 'CASH', version: 1 });

  /** Lấy hết các lô theo con trỏ (giới hạn vòng lặp để test không treo khi có lỗi). */
  async function collect(path: string, token: string, limit: number, extra: Record<string, string> = {}) {
    const pages: Array<{ items: Array<Record<string, unknown>>; nextCursor: string | null; body: Record<string, unknown> }> = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 30; guard++) {
      const res = await http()
        .get(path)
        .query({ limit: String(limit), ...extra, ...(cursor ? { cursor } : {}) })
        .set(authed(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const data = res.body.data as { items: Array<Record<string, unknown>>; nextCursor: string | null };
      pages.push({ items: data.items, nextCursor: data.nextCursor, body: res.body.data });
      if (!data.nextCursor) break;
      cursor = data.nextCursor;
    }
    return pages;
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

    fixture = await createTwoTenantFixture(privileged, 'DayListPaging e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    const branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    const recA = await createUser(fixture.tenantA.id, 'receptionist', 'recA');
    receptionistA = recA.token;
    const docA = await createUser(fixture.tenantA.id, 'doctor', 'docA');
    doctorAToken = docA.token;
    doctorAId = docA.id;
    receptionistTenantB = (await createUser(fixture.tenantB.id, 'receptionist', 'recTB')).token;

    // Chi nhánh B của tenant A: tạo trực tiếp rồi gán tài khoản quản trị + bác sĩ chỉ cho chi nhánh B.
    const adminA = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminA');
    const created = await http().post('/api/v1/branches').set(authed(adminA.token)).send({ name: 'Chi nhánh phụ' });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    branchB = created.body.data.id;
    const adminB = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminB', [branchB]);
    adminBToken = adminB.token;
    const docB = await createUser(fixture.tenantA.id, 'doctor', 'docB', [branchB]);
    doctorBId = docB.id;
    expect(branchA).not.toBe(branchB);

    // Chi nhánh A: 8 lượt khám. 1-4 đã thu (2 đang khám), 5-6 chưa thu, 7 chưa thu rồi huỷ, 8 chưa thu.
    const names = ['Lan', 'Mai', 'Nam', 'Oanh', 'Phúc', 'Quân', 'Rạng', 'Sơn'].map((n, i) => `${tag} ${n}`.concat(i === 3 ? ' Đặng' : ''));
    const made: Array<{ encounterId: string; version: number }> = [];
    for (let i = 0; i < 8; i++) made.push(await intake(receptionistA, doctorAId, names[i]!, `09${String(10000000 + i * 1111).padStart(8, '0')}`));
    for (let i = 0; i < 4; i++) expect((await pay(receptionistA, made[i]!.encounterId)).status).toBe(200);
    for (let i = 0; i < 2; i++) {
      const started = await http().post(`/api/v1/encounters/${made[i]!.encounterId}/start`).set(authed(doctorAToken)).send({ version: 1 });
      expect(started.status, JSON.stringify(started.body)).toBe(200);
    }
    const cancelled = await http().post(`/api/v1/encounters/${made[6]!.encounterId}/cancel`).set(authed(receptionistA)).send({ cancelReason: 'Khách bỏ về', version: 1 });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    // Chi nhánh B: 2 lượt khám (chỉ adminB thấy).
    for (let i = 0; i < 2; i++) await intake(adminBToken, doctorBId, `${tag} Chi nhánh B ${i}`, `0988${String(100000 + i)}`);

    const all = await http().get('/api/v1/reception/list').set(authed(receptionistA));
    unpagedReception = all.body.data.items;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('GET /reception/list', () => {
    it('KHÔNG truyền limit → trả toàn bộ như trước (tương thích ngược) kèm số liệu cả ngày, nextCursor null', async () => {
      const res = await http().get('/api/v1/reception/list').set(authed(receptionistA));
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(8);
      expect(res.body.data.nextCursor).toBeNull();
      expect(res.body.data.counts).toMatchObject({ total: 7, cancelled: 1 });
      expect(res.body.data.tabCounts.all).toBe(8);
    });

    it('các lô nối lại = đúng toàn bộ danh sách, theo thứ tự, không trùng/sót; số liệu cả ngày KHÔNG đổi giữa các lô', async () => {
      const pages = await collect('/api/v1/reception/list', receptionistA, 3);
      expect(pages.map((p) => p.items.length)).toEqual([3, 3, 2]);
      expect(pages.map((p) => p.nextCursor !== null)).toEqual([true, true, false]);
      const ids = pages.flatMap((p) => p.items.map((i) => i.encounterId));
      expect(ids).toEqual(unpagedReception.map((i) => i.encounterId));
      expect(new Set(ids).size).toBe(8);
      for (const p of pages) {
        expect(p.body.counts).toEqual(pages[0]!.body.counts);
        expect(p.body.tabCounts).toEqual(pages[0]!.body.tabCounts);
      }
    });

    it('lô cuối đầy đúng limit vẫn nextCursor null (không có lô rỗng thừa)', async () => {
      const pages = await collect('/api/v1/reception/list', receptionistA, 4);
      expect(pages.map((p) => p.items.length)).toEqual([4, 4]);
      expect(pages[1]!.nextCursor).toBeNull();
    });

    it('lọc tab ở máy chủ trên CẢ NGÀY: số dòng khớp đúng và phân trang trong tab', async () => {
      const waiting = unpagedReception.filter((i) => i.status === 'CHECKED_IN');
      const pages = await collect('/api/v1/reception/list', receptionistA, 2, { tab: 'WAITING' });
      expect(pages.flatMap((p) => p.items.map((i) => i.encounterId))).toEqual(waiting.map((i) => i.encounterId));
      expect(pages[0]!.body.tabCounts).toMatchObject({ waiting: waiting.length, inProgress: 2, all: 8 });
      // Thẻ KPI luôn là số CẢ NGÀY dù đang lọc tab.
      expect(pages[0]!.body.counts).toMatchObject({ total: 7, waiting: waiting.length, inProgress: 2, cancelled: 1 });
      const inProgress = await collect('/api/v1/reception/list', receptionistA, 10, { tab: 'IN_PROGRESS' });
      expect(inProgress[0]!.items).toHaveLength(2);
      const unpaid = unpagedReception.filter((i) => i.invoiceStatus === 'UNPAID');
      const unpaidPages = await collect('/api/v1/reception/list', receptionistA, 10, { tab: 'UNPAID' });
      expect(unpaidPages[0]!.items).toHaveLength(unpaid.length);
    });

    it('tab=ACTIVE (không limit) = đang chờ + đang khám, đủ cho bảng "Tải theo Bác sĩ", kèm danh sách bác sĩ có lượt khám', async () => {
      const res = await http().get('/api/v1/reception/list').query({ tab: 'ACTIVE' }).set(authed(receptionistA));
      expect(res.status).toBe(200);
      expect(res.body.data.items.every((i: { status: string }) => i.status === 'CHECKED_IN' || i.status === 'IN_CONSULTATION')).toBe(true);
      expect(res.body.data.items).toHaveLength(unpagedReception.filter((i) => i.status === 'CHECKED_IN' || i.status === 'IN_CONSULTATION').length);
      expect(res.body.data.doctorIdsWithEncounters).toEqual([doctorAId]);
      expect(res.body.data.nextCursor).toBeNull();
    });

    it('tìm kiếm trên cả ngày: theo họ tên (không phân biệt hoa/thường, có dấu), số điện thoại, mã lượt khám; số trên tab khớp từ khoá, KPI vẫn cả ngày', async () => {
      const byName = await http().get('/api/v1/reception/list').query({ q: `${tag.toLowerCase()} oanh đặng`, limit: '5' }).set(authed(receptionistA));
      expect(byName.body.data.items).toHaveLength(1);
      expect(byName.body.data.tabCounts.all).toBe(1);
      expect(byName.body.data.counts.total).toBe(7);

      const phone = unpagedReception.length > 0 ? '091' : '';
      const byPhone = await http().get('/api/v1/reception/list').query({ q: `${phone}00000`, limit: '5' }).set(authed(receptionistA));
      expect(byPhone.status).toBe(200);

      const target = (await http().get('/api/v1/reception/list').set(authed(receptionistA))).body.data.items[2] as { encounterNo: string };
      const byNo = await http().get('/api/v1/reception/list').query({ q: target.encounterNo.toLowerCase(), limit: '5' }).set(authed(receptionistA));
      expect(byNo.body.data.items.map((i: { encounterNo: string }) => i.encounterNo)).toEqual([target.encounterNo]);

      const none = await http().get('/api/v1/reception/list').query({ q: 'khongcokhach' + randomUUID().slice(0, 4), limit: '5' }).set(authed(receptionistA));
      expect(none.body.data.items).toEqual([]);
      expect(none.body.data.tabCounts).toEqual({ all: 0, waiting: 0, inProgress: 0, unpaid: 0, done: 0 });
    });

    it('con trỏ giữ đúng khi có lượt khám MỚI tiếp nhận giữa hai lần tải: không trùng, không sót, lượt mới hiện ở lô cuối', async () => {
      const first = await http().get('/api/v1/reception/list').query({ limit: '5' }).set(authed(receptionistA));
      const fresh = await intake(receptionistA, doctorAId, `${tag} Mới đến`, '0977111222');
      const second = await http().get('/api/v1/reception/list').query({ limit: '5', cursor: first.body.data.nextCursor }).set(authed(receptionistA));
      const ids = [...first.body.data.items, ...second.body.data.items].map((i: { encounterId: string }) => i.encounterId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain(fresh.encounterId);
      expect(ids.slice(0, 8)).toEqual(unpagedReception.map((i) => i.encounterId).slice(0, 8));
      // Dọn lượt vừa tạo để các test sau (đếm theo số cố định) không lệch.
      await http().post(`/api/v1/encounters/${fresh.encounterId}/cancel`).set(authed(receptionistA)).send({ cancelReason: 'Dọn test', version: 1 });
    });

    it('tham số sai → 400 (limit 0/201/chữ, con trỏ rác, tab lạ), không 500', async () => {
      for (const query of [{ limit: '0' }, { limit: '201' }, { limit: 'abc' }, { limit: '5', cursor: 'khong-phai-con-tro' }, { limit: '5', cursor: 'abc$%' }, { tab: 'LA', limit: '5' }]) {
        const res = await http().get('/api/v1/reception/list').query(query).set(authed(receptionistA));
        expect(res.status, JSON.stringify(query)).toBe(400);
      }
    });

    it('CÔ LẬP TENANT: tenant B không thấy lượt khám/số liệu của A, con trỏ của A áp vào tenant B không lộ dữ liệu', async () => {
      const first = await http().get('/api/v1/reception/list').query({ limit: '3' }).set(authed(receptionistA));
      const asB = await http().get('/api/v1/reception/list').query({ limit: '3', cursor: first.body.data.nextCursor }).set(authed(receptionistTenantB));
      expect(asB.status).toBe(200);
      expect(asB.body.data.items).toEqual([]);
      expect(asB.body.data.counts).toEqual({ total: 0, waiting: 0, inProgress: 0, unpaid: 0, done: 0, cancelled: 0 });
      expect(asB.body.data.doctorIdsWithEncounters).toEqual([]);
    });

    it('CÔ LẬP CHI NHÁNH: chi nhánh B chỉ thấy 2 lượt của mình (cả số liệu); chi nhánh A không thấy lượt của B; con trỏ A áp vào B không lộ dòng', async () => {
      const asB = await collect('/api/v1/reception/list', adminBToken, 1);
      expect(asB.flatMap((p) => p.items.map((i) => i.fullName))).toEqual([`${tag} Chi nhánh B 0`, `${tag} Chi nhánh B 1`]);
      expect(asB[0]!.body.counts).toMatchObject({ total: 2 });
      expect(asB[0]!.body.doctorIdsWithEncounters).toEqual([doctorBId]);
      expect(unpagedReception.every((i) => !i.fullName.includes('Chi nhánh B'))).toBe(true);

      const firstA = await http().get('/api/v1/reception/list').query({ limit: '3' }).set(authed(receptionistA));
      const crossed = await http().get('/api/v1/reception/list').query({ limit: '50', cursor: firstA.body.data.nextCursor }).set(authed(adminBToken));
      expect(crossed.body.data.items.every((i: { fullName: string }) => i.fullName.includes('Chi nhánh B'))).toBe(true);
    });
  });

  describe('GET /billing/invoices', () => {
    it('KHÔNG truyền limit → trả toàn bộ như trước, tổng kết ngày đúng, nextCursor null', async () => {
      const res = await http().get('/api/v1/billing/invoices').set(authed(receptionistA));
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(8);
      expect(res.body.data.nextCursor).toBeNull();
      expect(res.body.data.paidCount).toBe(4);
      expect(res.body.data.paidTotalAmount).toBe(600_000);
      expect(res.body.data.tabCounts.all).toBe(res.body.data.items.length);
    });

    it('các lô nối lại = toàn bộ, không trùng; tổng kết ngày và số trên tab KHÔNG đổi theo lô', async () => {
      const full = (await http().get('/api/v1/billing/invoices').set(authed(receptionistA))).body.data;
      const pages = await collect('/api/v1/billing/invoices', receptionistA, 3, { tab: 'ALL' });
      const ids = pages.flatMap((p) => p.items.map((i) => i.invoiceId));
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(full.items.map((i: { invoiceId: string }) => i.invoiceId).sort());
      for (const p of pages) {
        for (const k of ['paidCount', 'paidTotalAmount', 'unpaidCount', 'unpaidTotalAmount', 'refundedCount', 'refundedTotalAmount', 'netTotalAmount', 'tabCounts']) {
          expect(p.body[k], k).toEqual(full[k]);
        }
      }
    });

    it('tab Chờ thu / Đã thu lọc đúng ở máy chủ và vẫn phân trang; tổng kết ngày không phụ thuộc tab', async () => {
      const unpaid = await collect('/api/v1/billing/invoices', receptionistA, 2, { tab: 'UNPAID' });
      expect(unpaid.flatMap((p) => p.items).every((i) => i.status === 'UNPAID')).toBe(true);
      const paid = await collect('/api/v1/billing/invoices', receptionistA, 2, { tab: 'PAID' });
      expect(paid.flatMap((p) => p.items)).toHaveLength(4);
      expect(paid[0]!.body.tabCounts).toMatchObject({ paid: 4 });
      expect(unpaid[0]!.body.paidTotalAmount).toBe(paid[0]!.body.paidTotalAmount);
    });

    it('tìm kiếm cả ngày theo họ tên/mã phiếu/mã lượt khám/mã bệnh nhân; số trên tab khớp từ khoá; tổng kết ngày vẫn cả ngày', async () => {
      const byName = await http().get('/api/v1/billing/invoices').query({ q: `${tag} sơn`, tab: 'ALL', limit: '5' }).set(authed(receptionistA));
      expect(byName.body.data.items).toHaveLength(1);
      expect(byName.body.data.tabCounts).toEqual({ unpaid: 1, paid: 0, all: 1 });
      expect(byName.body.data.paidCount).toBe(4);

      const invoiceNo = (byName.body.data.items[0] as { invoiceNo: string }).invoiceNo;
      const byInvoice = await http().get('/api/v1/billing/invoices').query({ q: invoiceNo.toLowerCase(), tab: 'ALL', limit: '5' }).set(authed(receptionistA));
      expect(byInvoice.body.data.items.map((i: { invoiceNo: string }) => i.invoiceNo)).toEqual([invoiceNo]);
    });

    it('tham số sai → 400, không 500', async () => {
      for (const query of [{ limit: '0' }, { limit: '201' }, { limit: '5', cursor: 'khong-phai-con-tro' }, { tab: 'LA', limit: '5' }]) {
        const res = await http().get('/api/v1/billing/invoices').query(query).set(authed(receptionistA));
        expect(res.status, JSON.stringify(query)).toBe(400);
      }
    });

    it('CÔ LẬP TENANT + CHI NHÁNH: tenant B và chi nhánh A không thấy phiếu của chi nhánh B và ngược lại; con trỏ chéo không lộ dòng', async () => {
      const asTenantB = await http().get('/api/v1/billing/invoices').query({ limit: '5', tab: 'ALL' }).set(authed(receptionistTenantB));
      expect(asTenantB.body.data.items).toEqual([]);
      expect(asTenantB.body.data.paidTotalAmount).toBe(0);

      const branchBInvoices = await collect('/api/v1/billing/invoices', adminBToken, 1, { tab: 'ALL' });
      expect(branchBInvoices.flatMap((p) => p.items.map((i) => i.fullName))).toEqual([`${tag} Chi nhánh B 0`, `${tag} Chi nhánh B 1`]);
      expect(branchBInvoices[0]!.body.tabCounts).toEqual({ unpaid: 2, paid: 0, all: 2 });

      const firstA = await http().get('/api/v1/billing/invoices').query({ limit: '3', tab: 'ALL' }).set(authed(receptionistA));
      const crossed = await http().get('/api/v1/billing/invoices').query({ limit: '50', tab: 'ALL', cursor: firstA.body.data.nextCursor }).set(authed(adminBToken));
      expect(crossed.body.data.items.every((i: { fullName: string }) => i.fullName.includes('Chi nhánh B'))).toBe(true);
    });
  });
});
