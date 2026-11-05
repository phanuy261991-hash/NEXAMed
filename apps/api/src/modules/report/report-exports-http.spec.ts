import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — Excel của 4 báo cáo cũ được bổ sung theo quy tắc "mọi báo cáo phải xuất được Excel" (docs/DECISIONS.md #287): Ví tạm ứng, Công nợ nhà cung cấp, Tồn kho và hạn dùng, Nhật ký kiểm toán.
 * Trọng tâm: số liệu khớp bộ lọc đang xem, ô số là SỐ (cộng được trong Excel), quyền riêng của từng báo cáo (thiếu → 403, không ghi nhật ký), cô lập công ty, và việc xuất được ghi vào nhật ký.
 */
describe('HTTP e2e — Excel của Ví tạm ứng, Công nợ NCC, Tồn kho, Nhật ký kiểm toán', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let adminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let noPermissionToken: string;
  let tenantBAdminToken: string;
  let branchA: string;
  let drugId: string;
  let warehouseId: string;
  let supplierDebtId: string;
  let supplierIdleId: string;

  async function sheetsOf(buffer: Buffer): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb;
  }
  /** Mọi giá trị ô của một sheet, nối thành một chuỗi để tìm nhanh. */
  const textOf = (sheet: ExcelJS.Worksheet) => sheet.getSheetValues().flat().filter((v) => typeof v === 'string' || typeof v === 'number').join('|');
  /** Dòng có ô đầu tiên bằng `first`. */
  const rowStarting = (sheet: ExcelJS.Worksheet, first: string): ExcelJS.CellValue[] | undefined => {
    for (let r = 1; r <= sheet.rowCount; r += 1) {
      const values = sheet.getRow(r).values as ExcelJS.CellValue[];
      if (values[1] === first) return values;
    }
    return undefined;
  };
  const exportedCount = (action: string) => privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action } });

  async function makePatient(tag: string) {
    const n = Math.floor(Math.random() * 1_000_000_000);
    return privileged.patient.create({
      data: { tenantId: fixture.tenantA.id, patientCode: `BN-XL-${tag}-${n}`, fullName: `Bệnh nhân ví ${tag}`, dob: new Date('1990-01-01'), gender: 'other', phone: `09${String(n).padStart(8, '0').slice(-8)}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
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

    fixture = await createTwoTenantFixture(privileged, 'Report exports e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'xl-admin', [branchA]);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'xl-doctor', [branchA]);
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'xl-recep', [branchA]);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    const noPermRole = await h.createRoleWithPermissions(fixture.tenantA.id, 'khong-quyen-bao-cao', [['patient', 'read']]);
    const noPerm = await h.createUser(fixture.tenantA.id, { id: noPermRole }, 'xl-noperm', [branchA]);
    noPermissionToken = await h.login(fixture.tenantA.id, noPerm.username);
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'xl-adminB');
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);

    // Ví: một đang hoạt động (500.000), một đã khoá (0).
    const p1 = await makePatient('hd');
    const p2 = await makePatient('khoa');
    await privileged.patientWallet.create({ data: { tenantId: fixture.tenantA.id, patientId: p1.id, balance: BigInt(500_000), status: 'ACTIVE', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    await privileged.patientWallet.create({ data: { tenantId: fixture.tenantA.id, patientId: p2.id, balance: BigInt(0), status: 'CLOSED', closedAt: new Date(), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });

    // Nhà cung cấp: một có nợ đầu kỳ 3.000.000 (khai qua API), một chưa phát sinh gì.
    const s1 = await privileged.supplier.create({ data: { tenantId: fixture.tenantA.id, code: 'NCC-XL1', name: 'Công ty thuốc Một', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const s2 = await privileged.supplier.create({ data: { tenantId: fixture.tenantA.id, code: 'NCC-XL2', name: 'Công ty vật tư Hai', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    supplierDebtId = s1.id;
    supplierIdleId = s2.id;
    const opening = await http().post(`/api/v1/supplier-debt/${supplierDebtId}/opening-balance`).set(authed(adminToken)).send({ amount: 3_000_000, occurredAt: '2026-01-01', note: 'Nợ đầu kỳ thử' });
    expect(opening.status, JSON.stringify(opening.body)).toBe(200);

    // Tồn kho: một thuốc tồn 120.
    drugId = await h.createDrug(adminToken);
    const warehouses = await http().get('/api/v1/warehouses').set(authed(adminToken));
    warehouseId = warehouses.body.data.items[0].id;
    await h.approvedOpeningReceipt(adminToken, warehouseId, drugId, 120);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('Ví tạm ứng — GET /wallet/export', () => {
    it('chưa đăng nhập 401; lễ tân và bác sĩ (không có settle) 403; không ghi nhật ký khi bị từ chối', async () => {
      const before = await exportedCount('wallet_list.exported');
      expect((await http().get('/api/v1/wallet/export')).status).toBe(401);
      expect((await h.download('/api/v1/wallet/export', receptionistToken)).status).toBe(403);
      expect((await h.download('/api/v1/wallet/export', doctorToken)).status).toBe(403);
      expect(await exportedCount('wallet_list.exported')).toBe(before);
    });

    it('quản trị: sheet "Ví tạm ứng", số dư là SỐ, ghi nhật ký xuất', async () => {
      const before = await exportedCount('wallet_list.exported');
      const res = await h.download('/api/v1/wallet/export', adminToken);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      const wb = await sheetsOf(res.body as Buffer);
      expect(wb.worksheets.map((s) => s.name)).toEqual(['Ví tạm ứng']);
      const sheet = wb.worksheets[0]!;
      const text = textOf(sheet);
      expect(text).toContain('Bệnh nhân ví hd');
      expect(text).toContain('Bệnh nhân ví khoa');
      const row = [...Array(sheet.rowCount)].map((_, i) => sheet.getRow(i + 1).values as ExcelJS.CellValue[]).find((v) => v[2] === 'Bệnh nhân ví hd')!;
      expect(row[4]).toBe(500_000);
      expect(row[8]).toBe('Đang hoạt động');
      expect(await exportedCount('wallet_list.exported')).toBe(before + 1);
    });

    it('lọc theo trạng thái và từ khoá giống màn hình', async () => {
      const closed = await sheetsOf((await h.download('/api/v1/wallet/export?status=CLOSED', adminToken)).body as Buffer);
      const closedText = textOf(closed.worksheets[0]!);
      expect(closedText).toContain('Bệnh nhân ví khoa');
      expect(closedText).not.toContain('Bệnh nhân ví hd');
      const searched = await sheetsOf((await h.download('/api/v1/wallet/export?q=zzzkhongco', adminToken)).body as Buffer);
      expect(textOf(searched.worksheets[0]!)).toContain('Không có ví nào.');
    });

    it('công ty khác không thấy ví của công ty này', async () => {
      const wb = await sheetsOf((await h.download('/api/v1/wallet/export', tenantBAdminToken)).body as Buffer);
      expect(textOf(wb.worksheets[0]!)).not.toContain('Bệnh nhân ví');
    });
  });

  describe('Công nợ nhà cung cấp — GET /supplier-debt/summaries/export', () => {
    it('401; bác sĩ 403; quản trị có số nợ là SỐ và tình trạng "Còn nợ"', async () => {
      expect((await http().get('/api/v1/supplier-debt/summaries/export')).status).toBe(401);
      expect((await h.download('/api/v1/supplier-debt/summaries/export', doctorToken)).status).toBe(403);
      const before = await exportedCount('supplier_debt.exported');
      const res = await h.download('/api/v1/supplier-debt/summaries/export', adminToken);
      expect(res.status).toBe(200);
      const sheet = (await sheetsOf(res.body as Buffer)).worksheets[0]!;
      expect(sheet.name).toBe('Công nợ NCC');
      const debt = rowStarting(sheet, 'NCC-XL1')!;
      expect(debt[2]).toBe('Công ty thuốc Một');
      expect(debt[5]).toBe(3_000_000);
      expect(debt[7]).toBe('Còn nợ');
      expect(rowStarting(sheet, 'NCC-XL2')).toBeDefined();
      expect(await exportedCount('supplier_debt.exported')).toBe(before + 1);
    });

    it('showAll=false chỉ giữ nhà cung cấp có phát sinh; tìm theo tên', async () => {
      const onlyDebt = (await sheetsOf((await h.download('/api/v1/supplier-debt/summaries/export?showAll=false', adminToken)).body as Buffer)).worksheets[0]!;
      expect(rowStarting(onlyDebt, 'NCC-XL1')).toBeDefined();
      expect(rowStarting(onlyDebt, 'NCC-XL2')).toBeUndefined();
      const searched = (await sheetsOf((await h.download('/api/v1/supplier-debt/summaries/export?q=vat%20tu', adminToken)).body as Buffer)).worksheets[0]!;
      // "vat tu" không khớp "vật tư" có dấu (máy chủ so khớp chữ thường như màn hình) → không có dòng nhà cung cấp nào.
      expect(rowStarting(searched, 'NCC-XL1')).toBeUndefined();
      const byCode = (await sheetsOf((await h.download('/api/v1/supplier-debt/summaries/export?q=ncc-xl2', adminToken)).body as Buffer)).worksheets[0]!;
      expect(rowStarting(byCode, 'NCC-XL2')).toBeDefined();
      expect(rowStarting(byCode, 'NCC-XL1')).toBeUndefined();
      expect(supplierIdleId).toBeTruthy();
    });

    it('công ty khác không thấy nhà cung cấp của công ty này', async () => {
      const sheet = (await sheetsOf((await h.download('/api/v1/supplier-debt/summaries/export', tenantBAdminToken)).body as Buffer)).worksheets[0]!;
      expect(rowStarting(sheet, 'NCC-XL1')).toBeUndefined();
    });
  });

  describe('Tồn kho và hạn dùng — GET /inventory/balances/export', () => {
    it('401; vai trò không có stock_receipt.read 403; quản trị có hai sheet và tồn là SỐ', async () => {
      expect((await http().get('/api/v1/inventory/balances/export')).status).toBe(401);
      expect((await h.download('/api/v1/inventory/balances/export', noPermissionToken)).status).toBe(403);
      const before = await exportedCount('stock_balance.exported');
      const res = await h.download('/api/v1/inventory/balances/export', adminToken);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const wb = await sheetsOf(res.body as Buffer);
      expect(wb.worksheets.map((s) => s.name)).toEqual(['Tồn kho', 'Cảnh báo hạn dùng']);
      const stock = wb.worksheets[0]!;
      const row = [...Array(stock.rowCount)].map((_, i) => stock.getRow(i + 1).values as ExcelJS.CellValue[]).find((v) => v[2] === 'Paracetamol 500mg')!;
      expect(row).toBeDefined();
      expect(row[6]).toBe(120);
      expect(row[9]).toBe('Bình thường');
      expect(textOf(wb.worksheets[1]!)).toContain('Không có lô nào sắp hoặc đã hết hạn.');
      expect(await exportedCount('stock_balance.exported')).toBe(before + 1);
    });

    it('lọc "chỉ dưới định mức" bỏ mặt hàng chưa đặt định mức; kho lạ thì không có dòng', async () => {
      const below = (await sheetsOf((await h.download('/api/v1/inventory/balances/export?belowMinOnly=true', adminToken)).body as Buffer)).worksheets[0]!;
      expect(textOf(below)).not.toContain('Paracetamol 500mg');
      const otherWarehouse = (await sheetsOf((await h.download(`/api/v1/inventory/balances/export?warehouseId=${randomUUID()}`, adminToken)).body as Buffer)).worksheets[0]!;
      expect(textOf(otherWarehouse)).not.toContain('Paracetamol 500mg');
    });

    it('công ty khác không thấy tồn kho của công ty này', async () => {
      const wb = await sheetsOf((await h.download('/api/v1/inventory/balances/export', tenantBAdminToken)).body as Buffer);
      expect(textOf(wb.worksheets[0]!)).not.toContain('Paracetamol 500mg');
    });
  });

  describe('Nhật ký kiểm toán — GET /audit-log/export', () => {
    it('401; bác sĩ 403; quản trị có nhãn tiếng Việt và KHÔNG có dữ liệu thô (before/after)', async () => {
      expect((await http().get('/api/v1/audit-log/export')).status).toBe(401);
      expect((await h.download('/api/v1/audit-log/export', doctorToken)).status).toBe(403);
      const res = await h.download('/api/v1/audit-log/export', adminToken);
      expect(res.status).toBe(200);
      const sheet = (await sheetsOf(res.body as Buffer)).worksheets[0]!;
      expect(sheet.name).toBe('Nhật ký kiểm toán');
      const text = textOf(sheet);
      expect(text).toContain('Thời gian');
      expect(text).not.toContain('beforeJson');
      // Cột Hành động (3) và Đối tượng (4) của dòng dữ liệu chỉ là nhãn tiếng Việt, không lộ mã UUID thô (đầu báo cáo có tên phòng khám nên không quét cả sheet).
      const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
      const dataRows = [...Array(sheet.rowCount)].map((_, i) => sheet.getRow(i + 1).values as ExcelJS.CellValue[]).filter((v) => typeof v[1] === 'string' && /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(v[1] as string));
      expect(dataRows.length).toBeGreaterThan(0);
      for (const v of dataRows) {
        expect(String(v[3])).not.toMatch(uuid);
        expect(String(v[4])).not.toMatch(uuid);
      }
    });

    it('việc xuất cũng được ghi nhật ký và lần xuất sau thấy dòng đó với nhãn tiếng Việt', async () => {
      const before = await exportedCount('audit_log.exported');
      await h.download('/api/v1/audit-log/export', adminToken);
      expect(await exportedCount('audit_log.exported')).toBe(before + 1);
      const second = (await sheetsOf((await h.download('/api/v1/audit-log/export', adminToken)).body as Buffer)).worksheets[0]!;
      expect(textOf(second)).toContain('Xuất Excel nhật ký kiểm toán');
    });

    it('lọc khoảng ngày xa trong quá khứ → không có bản ghi', async () => {
      const sheet = (await sheetsOf((await h.download('/api/v1/audit-log/export?from=2000-01-01&to=2000-01-02', adminToken)).body as Buffer)).worksheets[0]!;
      expect(textOf(sheet)).toContain('Không có bản ghi nào khớp bộ lọc.');
    });

    it('tham số sai định dạng → lỗi kiểm tra đầu vào, không phải 500', async () => {
      const res = await h.download('/api/v1/audit-log/export?from=hom-nay', adminToken);
      expect([400, 422]).toContain(res.status);
    });

    it('công ty khác không thấy nhật ký của công ty này', async () => {
      const sheet = (await sheetsOf((await h.download('/api/v1/audit-log/export', tenantBAdminToken)).body as Buffer)).worksheets[0]!;
      expect(textOf(sheet)).not.toContain('Bệnh nhân ví');
    });
  });
});
