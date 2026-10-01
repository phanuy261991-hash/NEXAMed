import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { buildDrugExportWorkbook } from './drug-import.workbook';
import type { ImportRecord } from './drug-import.columns';

/**
 * HTTP e2e "Nhập/Xuất Excel Thuốc & Vật tư" (docs/DECISIONS.md #210) — file Excel dựng THẬT bằng exceljs (cùng
 * bộ dựng với file xuất), đi qua toàn bộ stack (multer → đọc file → đối chiếu danh mục → Zod `createDrugRequestSchema`).
 */
describe('HTTP e2e — /api/v1/drugs/import-template|export|import', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';
  /** Gắn vào mọi TÊN danh mục dùng chung do test tạo → dọn được sau cùng (bảng toàn hệ thống, không tenant). */
  const tag = randomUUID().slice(0, 8);

  let clinicAdminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let noManageToken: string;
  let tenantBAdminToken: string;

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function loginNewUser(tenantId: string, roleId: string) {
    const username = `e2e-drugimp-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: 'User import', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  async function createUserWithRole(tenantId: string, roleName: string) {
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    return loginNewUser(tenantId, role.id);
  }

  /** Vai trò tuỳ biến CHỈ có `drug.create` + `drug.read` (không `reference_catalog.manage`). */
  async function createNoManageUser(tenantId: string) {
    const role = await privileged.role.create({ data: { tenantId, name: `no-manage-${tag}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    for (const action of ['create', 'read']) {
      const permission = await privileged.permission.findFirstOrThrow({ where: { module: 'drug', action } });
      await privileged.rolePermission.create({
        data: { tenantId, roleId: role.id, permissionId: permission.id, dataScope: 'global', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    return loginNewUser(tenantId, role.id);
  }

  async function download(path: string, token: string) {
    return request(app.getHttpServer())
      .get(path)
      .set(authed(token))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  }

  async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return wb;
  }

  const medicine = (code: string, overrides: ImportRecord = {}): ImportRecord => ({
    code,
    name: `Thuốc ${code}`,
    itemType: 'Thuốc',
    baseUnit: `Viên-${tag}`,
    price: 1500,
    manufacturer: `Hãng-${tag}`,
    drugGroup: `Nhóm-${tag}`,
    route: `Uống-${tag}`,
    registrationNumber: 'VD-1',
    dosageForm: `Viên nén-${tag}`,
    country: `Việt Nam-${tag}`,
    ...overrides,
  });
  const supply = (code: string, overrides: ImportRecord = {}): ImportRecord => ({
    code,
    name: `Vật tư ${code}`,
    itemType: 'Vật tư',
    baseUnit: `Cái-${tag}`,
    price: 1200,
    manufacturer: `Hãng-${tag}`,
    ...overrides,
  });
  const ingredient = (code: string, name = `Hoạt chất-${tag}`, strength: string | number = 500, unit = `mg-${tag}`): ImportRecord => ({
    code,
    ingredient: name,
    strength,
    strengthUnit: unit,
  });

  const xlsx = (items: ImportRecord[], ingredients: ImportRecord[] = [], units: ImportRecord[] = []) => buildDrugExportWorkbook(items, ingredients, units);

  function upload(path: 'preview' | 'commit', token: string, file: Buffer | null) {
    const req = request(app.getHttpServer()).post(`/api/v1/drugs/import/${path}`).set(authed(token));
    return file ? req.attach('file', file, { filename: 'thuoc.xlsx' }) : req;
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

    fixture = await createTwoTenantFixture(privileged, 'Drug import e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    noManageToken = await createNoManageUser(fixture.tenantA.id);
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
  });

  afterAll(async () => {
    await fixture.cleanup();
    // Danh mục dùng chung do test tạo qua nhập Excel (bảng toàn hệ thống) — dọn theo `tag`.
    await privileged.referenceCatalog.deleteMany({ where: { name: { contains: tag } } });
    await privileged.$disconnect();
    await app.close();
  });

  describe('file mẫu', () => {
    it('clinic_admin tải file mẫu → xlsx 5 sheet, sheet 1 có đúng 3 dòng ví dụ mã VD-, sheet Hoạt chất/Quy đổi có dữ liệu mẫu', async () => {
      const res = await download('/api/v1/drugs/import-template', clinicAdminToken);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
      expect(res.headers['content-disposition']).toContain('mau-nhap-thuoc-vat-tu.xlsx');

      const wb = await loadWorkbook(res.body as Buffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Thuốc & Vật tư', 'Hoạt chất', 'Quy đổi đơn vị', 'Hướng dẫn', 'Danh mục hiện có']);
      const items = wb.getWorksheet('Thuốc & Vật tư')!;
      expect(String(items.getCell(1, 1).value)).toBe('Mã *');
      const codes = [2, 3, 4].map((r) => String(items.getCell(r, 1).value));
      expect(codes).toEqual(['VD-THUOC-01', 'VD-THUOC-02', 'VD-VATTU-01']);
      expect(wb.getWorksheet('Hoạt chất')!.rowCount).toBe(4);
      expect(wb.getWorksheet('Quy đổi đơn vị')!.rowCount).toBe(4);
      expect(wb.getWorksheet('Hướng dẫn')!.rowCount).toBeGreaterThan(20);
    });

    it('file mẫu tải về rồi nhập lại NGUYÊN VẸN → mọi dòng ví dụ bị bỏ qua (9 dòng), không lỗi, không nhập gì', async () => {
      const template = (await download('/api/v1/drugs/import-template', clinicAdminToken)).body as Buffer;
      const res = await upload('preview', clinicAdminToken, template);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ validRows: [], duplicateRows: [], errorRows: [], newCatalogItems: [], exampleRowCount: 9 });
    });

    it('bỏ tiền tố VD- khỏi file mẫu → 3 mặt hàng mẫu ĐỀU hợp lệ (mẫu luôn nhập lại được)', async () => {
      const template = (await download('/api/v1/drugs/import-template', clinicAdminToken)).body as Buffer;
      const wb = await loadWorkbook(template);
      for (const name of ['Thuốc & Vật tư', 'Hoạt chất', 'Quy đổi đơn vị']) {
        const sheet = wb.getWorksheet(name)!;
        for (let r = 2; r <= sheet.rowCount; r++) {
          const cell = sheet.getCell(r, 1);
          if (typeof cell.value === 'string' && cell.value.startsWith('VD-')) cell.value = cell.value.replace('VD-', `OK${tag}-`);
        }
      }
      const file = Buffer.from(await wb.xlsx.writeBuffer());
      const res = await upload('preview', clinicAdminToken, file);
      expect(res.status).toBe(200);
      expect(res.body.data.errorRows).toEqual([]);
      expect(res.body.data.validRows.map((r: { code: string }) => r.code)).toEqual([`OK${tag}-THUOC-01`, `OK${tag}-THUOC-02`, `OK${tag}-VATTU-01`]);
      expect(res.body.data.validRows[1]).toMatchObject({ ingredientCount: 2, unitCount: 2, itemType: 'MEDICINE' });
      expect(res.body.data.exampleRowCount).toBe(0);
    });

    it('bác sĩ/lễ tân (không có drug.create) tải file mẫu → 403; không token → 401', async () => {
      expect((await download('/api/v1/drugs/import-template', doctorToken)).status).toBe(403);
      expect((await download('/api/v1/drugs/import-template', receptionistToken)).status).toBe(403);
      expect((await request(app.getHttpServer()).get('/api/v1/drugs/import-template')).status).toBe(401);
    });
  });

  describe('xem trước (preview) — chỉ đọc', () => {
    it('3 nhóm: hợp lệ + danh mục sẽ tạo mới; KHÔNG ghi mặt hàng/danh mục nào', async () => {
      const code = `PV${tag}`;
      const res = await upload('preview', clinicAdminToken, await xlsx([medicine(code)], [ingredient(code)]));
      expect(res.status).toBe(200);
      expect(res.body.data.errorRows).toEqual([]);
      expect(res.body.data.validRows).toHaveLength(1);
      expect(res.body.data.validRows[0]).toMatchObject({ code, itemType: 'MEDICINE', ingredientCount: 1, unitCount: 0 });
      const created = res.body.data.newCatalogItems as { category: string; name: string }[];
      expect(created.map((c) => c.category).sort()).toEqual(
        ['ACTIVE_INGREDIENT', 'COUNTRY_OF_ORIGIN', 'DOSAGE_FORM', 'DRUG_GROUP', 'DRUG_ROUTE', 'MANUFACTURER', 'UNIT', 'UNIT'],
      );
      // Chưa ghi gì.
      expect(await privileged.drug.count({ where: { tenantId: fixture.tenantA.id, code } })).toBe(0);
      expect(await privileged.referenceCatalog.count({ where: { name: { contains: `Hãng-${tag}` } } })).toBe(0);
    });

    it('báo đúng lỗi từng dòng (sheet + số dòng + lý do), mặt hàng lỗi KHÔNG nằm trong nhóm hợp lệ và KHÔNG sinh danh mục mới', async () => {
      const items = [
        medicine(`E1${tag}`, { name: '' }), // thiếu tên
        medicine(`E2${tag}`, { itemType: 'Hoá chất' }), // loại sai
        medicine(`E3${tag}`, { price: 1500.5 }), // giá lẻ
        medicine(`E4${tag}`, { manufacturer: `Hãng-DUY-NHAT-LOI-${tag}` }), // thuốc không có hoạt chất
        medicine(`E5${tag}`), // lặp mã (dòng sau)
        medicine(`E5${tag}`),
        supply(`E6${tag}`), // vật tư có hoạt chất (dòng con)
        medicine(`E7${tag}`), // giá bậc quy đổi điền thiếu
        medicine(`E8${tag}`), // đơn vị lớn trùng đơn vị cơ sở
        medicine(`E9${tag}`, { isBatchManaged: 'có lẽ' }),
        medicine(`OK${tag}`),
      ];
      const ingredients = [
        ingredient(`E1${tag}`),
        ingredient(`E2${tag}`),
        ingredient(`E3${tag}`),
        ingredient(`E5${tag}`),
        ingredient(`E6${tag}`),
        ingredient(`E7${tag}`),
        ingredient(`E8${tag}`),
        ingredient(`E9${tag}`),
        ingredient(`OK${tag}`),
        ingredient(`KHONG-CO-${tag}`), // mồ côi
        ingredient(`OK${tag}`, `Hoạt chất-${tag}`, 'abc'), // hàm lượng sai (cùng mã hợp lệ → cũng làm OK lỗi)
      ];
      const units = [
        { code: `E7${tag}`, unit: `Vỉ-${tag}`, factor: 10, price: 5000 },
        { code: `E7${tag}`, unit: `Hộp-${tag}`, factor: 10, price: '' },
        { code: `E8${tag}`, unit: `Viên-${tag}`, factor: 10, price: '' },
      ];
      const res = await upload('preview', clinicAdminToken, await xlsx(items, ingredients, units));
      expect(res.status).toBe(200);
      const reasons = (res.body.data.errorRows as { sheet: string; rowNumber: number; code: string; reason: string }[]).map((e) => `${e.code.replace(tag, '')}|${e.sheet}|${e.reason}`);
      expect(reasons).toEqual(expect.arrayContaining([
        expect.stringContaining('E1|Thuốc & Vật tư|Thiếu Tên.'),
        expect.stringContaining('E2|Thuốc & Vật tư|Loại phải là'),
        expect.stringContaining('E3|Thuốc & Vật tư|Giá bán phải là số nguyên'),
        expect.stringContaining('E5|Thuốc & Vật tư|Mã bị lặp trong file'),
        expect.stringContaining('E6|Hoạt chất|Vật tư y tế không có hoạt chất'),
        expect.stringContaining('E7|Quy đổi đơn vị|Giá bán các bậc quy đổi'),
        expect.stringContaining('E8|Quy đổi đơn vị|Đơn vị lớn hơn không được trùng đơn vị cơ sở'),
        expect.stringContaining('E9|Thuốc & Vật tư|"Quản lý theo lô" phải là Có hoặc Không'),
        expect.stringContaining('KHONG-CO-|Hoạt chất|Mã thuốc không có ở sheet'),
        expect.stringContaining('OK|Hoạt chất|Hàm lượng phải là số không âm'),
      ]));
      // E4: thuốc không có hoạt chất → lỗi từ schema chung.
      expect(reasons.some((r) => r.startsWith('E4|') && r.includes('ít nhất một Hoạt chất'))).toBe(true);
      // Lần xuất hiện ĐẦU của mã lặp vẫn hợp lệ; chỉ dòng lặp sau là lỗi.
      expect(res.body.data.validRows.map((r: { code: string }) => r.code)).toEqual([`E5${tag}`]);
      // Danh mục chỉ dùng bởi mặt hàng LỖI không bị liệt kê để tạo mới.
      const names = (res.body.data.newCatalogItems as { name: string }[]).map((n) => n.name);
      expect(names.some((n) => n.includes('DUY-NHAT-LOI'))).toBe(false);
    });

    it('sai tiêu đề cột / không phải xlsx / thiếu file → 400', async () => {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Thuốc & Vật tư');
      sheet.addRow(['Cột lạ', 'Tên']);
      const badHeader = Buffer.from(await wb.xlsx.writeBuffer());
      const r1 = await upload('preview', clinicAdminToken, badHeader);
      expect(r1.status).toBe(400);
      expect(r1.body.error.message).toContain('file không đúng mẫu');
      expect((await upload('preview', clinicAdminToken, Buffer.from('không phải excel'))).status).toBe(400);
      expect((await upload('preview', clinicAdminToken, null)).status).toBe(400);
    });

    it('quá 2.000 mặt hàng → 400, nêu rõ giới hạn', async () => {
      const many = Array.from({ length: 2001 }, (_, i) => supply(`BIG${i}`));
      const res = await upload('preview', clinicAdminToken, await xlsx(many));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('2.000');
    });

    it('vai trò có drug.create nhưng KHÔNG có reference_catalog.manage: tên danh mục chưa có → lỗi dòng, không tạo gì', async () => {
      const code = `NM${tag}`;
      const res = await upload('preview', noManageToken, await xlsx([medicine(code)], [ingredient(code)]));
      expect(res.status).toBe(200);
      expect(res.body.data.validRows).toEqual([]);
      expect(res.body.data.newCatalogItems).toEqual([]);
      expect((res.body.data.errorRows as { reason: string }[]).some((e) => e.reason.includes('không có quyền tạo mới danh mục dùng chung'))).toBe(true);
    });

    it('bác sĩ (drug.read, không drug.create) → 403 ở preview và commit', async () => {
      const file = await xlsx([supply(`DR${tag}`)]);
      expect((await upload('preview', doctorToken, file)).status).toBe(403);
      expect((await upload('commit', doctorToken, file)).status).toBe(403);
    });
  });

  describe('nhập thật (commit) + xuất lại', () => {
    const baseCode = `IM${tag}`;

    it('commit: tạo mặt hàng đủ hoạt chất/quy đổi/giá bậc + danh mục mới; gõ tắt; vật tư không giá bậc', async () => {
      const med = medicine(`${baseCode}-M`, { shortcutCode: `S${tag}`.toLowerCase(), controlType: 'Gây nghiện', isPrescriptionOnly: 'Không', barcode: '893', minStockAlert: 10, maxStockAlert: 100 });
      const sup = supply(`${baseCode}-V`);
      const file = await xlsx(
        [med, sup],
        [ingredient(`${baseCode}-M`, `Hoạt chất-${tag}`, '62,5'), ingredient(`${baseCode}-M`, `Hoạt chất 2-${tag}`, 500)],
        [
          { code: `${baseCode}-M`, unit: `Vỉ-${tag}`, factor: 10, price: 12000 },
          { code: `${baseCode}-M`, unit: `Hộp-${tag}`, factor: 5, price: 60000 },
          { code: `${baseCode}-V`, unit: `Hộp-${tag}`, factor: 100, price: '' },
        ],
      );
      const res = await upload('commit', clinicAdminToken, file);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ createdCount: 2, duplicateCount: 0, errorCount: 0 });
      expect(res.body.data.newCatalogItemCount).toBeGreaterThanOrEqual(8);

      const list = await request(app.getHttpServer()).get('/api/v1/drugs').query({ q: baseCode }).set(authed(clinicAdminToken));
      const items = list.body.data.items as {
        code: string; itemType: string; controlType: string; isPrescriptionOnly: boolean; barcode: string | null; shortcutCode: string | null; unitPricingEnabled: boolean;
        defaultSellPrice: number; minStockAlert: number; baseUnitCode: string; manufacturerCode: string;
        ingredients: { strengthValue: number }[]; units: { unitCode: string; sortOrder: number; factorToUnitBelow: number; sellPrice: number | null }[];
      }[];
      const m = items.find((i) => i.code === `${baseCode}-M`)!;
      const v = items.find((i) => i.code === `${baseCode}-V`)!;
      expect(m).toMatchObject({ itemType: 'MEDICINE', controlType: 'NARCOTIC', isPrescriptionOnly: false, barcode: '893', shortcutCode: `s${tag}`, unitPricingEnabled: true, defaultSellPrice: 1500, minStockAlert: 10 });
      expect(m.ingredients.map((i) => i.strengthValue).sort((a, b) => a - b)).toEqual([62500, 500000]);
      expect(m.units.map((u) => [u.sortOrder, u.factorToUnitBelow, u.sellPrice])).toEqual([[0, 10, 12000], [1, 5, 60000]]);
      expect(v).toMatchObject({ itemType: 'SUPPLY', unitPricingEnabled: false, barcode: null, controlType: 'NORMAL' });
      expect(v.units).toHaveLength(1);
      expect(v.units[0]!.sellPrice).toBeNull();
      // Mã danh mục là mã THẬT do hệ thống sinh (không phải mã tạm), đúng danh mục.
      expect(m.baseUnitCode).toMatch(/^DV/);
      expect(m.manufacturerCode).toMatch(/^HS/);
      const unitRow = await privileged.referenceCatalog.findFirst({ where: { category: 'UNIT', code: m.baseUnitCode } });
      expect(unitRow?.name).toBe(`Viên-${tag}`);
      // audit
      const audit = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: { in: ['drug.imported', 'drug.created'] } } });
      expect(audit.some((a) => a.action === 'drug.imported')).toBe(true);
      expect(audit.filter((a) => a.action === 'drug.created').length).toBeGreaterThanOrEqual(2);
    });

    it('nhập lại CÙNG file → cả 2 vào "Đã có sẵn", không tạo thêm gì (idempotent, không ghi đè)', async () => {
      const before = await privileged.referenceCatalog.count({ where: { name: { contains: tag } } });
      const file = await xlsx([medicine(`${baseCode}-M`, { name: 'TÊN KHÁC — không được ghi đè' }), supply(`${baseCode}-V`)], [ingredient(`${baseCode}-M`)]);
      const preview = await upload('preview', clinicAdminToken, file);
      expect(preview.body.data.duplicateRows.map((r: { code: string }) => r.code).sort()).toEqual([`${baseCode}-M`, `${baseCode}-V`]);
      expect(preview.body.data.validRows).toEqual([]);
      expect(preview.body.data.errorRows).toEqual([]);
      const commit = await upload('commit', clinicAdminToken, file);
      expect(commit.body.data).toMatchObject({ createdCount: 0, duplicateCount: 2, errorCount: 0, newCatalogItemCount: 0 });
      expect(await privileged.referenceCatalog.count({ where: { name: { contains: tag } } })).toBe(before);
      const m = await privileged.drug.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, code: `${baseCode}-M` } });
      expect(m.name).not.toContain('KHÁC');
    });

    it('gõ tắt trùng mặt hàng đã có trong hệ thống hoặc trùng trong file → lỗi dòng', async () => {
      const file = await xlsx([
        medicine(`SC1${tag}`, { shortcutCode: `S${tag}` }), // trùng IM...-M đã nhập (không phân biệt hoa thường)
        medicine(`SC2${tag}`, { shortcutCode: `n${tag}` }),
        medicine(`SC3${tag}`, { shortcutCode: `N${tag}` }), // trùng SC2 trong file
      ], [ingredient(`SC1${tag}`), ingredient(`SC2${tag}`), ingredient(`SC3${tag}`)]);
      const res = await upload('preview', clinicAdminToken, file);
      const reasons = (res.body.data.errorRows as { code: string; reason: string }[]).map((e) => `${e.code.replace(tag, '')}|${e.reason}`);
      expect(reasons.some((r) => r.startsWith('SC1|') && r.includes('đã được mặt hàng khác trong hệ thống dùng'))).toBe(true);
      expect(reasons.some((r) => r.startsWith('SC3|') && r.includes('trùng với mặt hàng ở dòng'))).toBe(true);
      expect(res.body.data.validRows.map((r: { code: string }) => r.code)).toEqual([`SC2${tag}`]);
    });

    it('commit file lẫn hợp lệ + lỗi → CHỈ nhập dòng hợp lệ; danh mục mới chỉ của mặt hàng hợp lệ', async () => {
      const file = await xlsx(
        [medicine(`MX1${tag}`), medicine(`MX2${tag}`, { price: 'x', manufacturer: `Hãng-CHI-LOI-${tag}` })],
        [ingredient(`MX1${tag}`), ingredient(`MX2${tag}`)],
      );
      const res = await upload('commit', clinicAdminToken, file);
      expect(res.body.data).toMatchObject({ createdCount: 1, errorCount: 1 });
      expect(await privileged.drug.count({ where: { tenantId: fixture.tenantA.id, code: `MX1${tag}` } })).toBe(1);
      expect(await privileged.drug.count({ where: { tenantId: fixture.tenantA.id, code: `MX2${tag}` } })).toBe(0);
      expect(await privileged.referenceCatalog.count({ where: { name: `Hãng-CHI-LOI-${tag}` } })).toBe(0);
    });

    it('nhập 300 mặt hàng trong 1 lần (1 transaction) thành công', async () => {
      const items = Array.from({ length: 300 }, (_, i) => supply(`BULK${tag}-${i}`));
      const res = await upload('commit', clinicAdminToken, await xlsx(items));
      expect(res.status).toBe(200);
      expect(res.body.data.createdCount).toBe(300);
      expect(await privileged.drug.count({ where: { tenantId: fixture.tenantA.id, code: { startsWith: `BULK${tag}-` } } })).toBe(300);
    }, 120_000);

    it('cách ly tenant: tenant B nhập CÙNG mã không bị coi là trùng với tenant A; danh mục dùng chung thì dùng lại mục đã có', async () => {
      const code = `${baseCode}-M`;
      const file = await xlsx([medicine(code)], [ingredient(code)]);
      const res = await upload('preview', tenantBAdminToken, file);
      expect(res.body.data.duplicateRows).toEqual([]);
      expect(res.body.data.validRows.map((r: { code: string }) => r.code)).toEqual([code]);
      // Tên danh mục đã được tenant A tạo → tenant B tái dùng, không đòi tạo mới.
      expect(res.body.data.newCatalogItems).toEqual([]);
      const commit = await upload('commit', tenantBAdminToken, file);
      expect(commit.body.data.createdCount).toBe(1);
      expect(await privileged.drug.count({ where: { tenantId: fixture.tenantA.id, code } })).toBe(1);
      expect(await privileged.drug.count({ where: { tenantId: fixture.tenantB.id, code } })).toBe(1);
    });

    it('xuất Excel: đủ 3 sheet, tên danh mục (không phải mã), hàm lượng/giá bậc đúng, ghi audit; tenant B không thấy mặt hàng tenant A; nhập lại file xuất → toàn bộ "Đã có sẵn"', async () => {
      const res = await download('/api/v1/drugs/export', doctorToken); // drug.read là đủ
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('danh-muc-thuoc-vat-tu.xlsx');
      const wb = await loadWorkbook(res.body as Buffer);
      const sheet = wb.getWorksheet('Thuốc & Vật tư')!;
      expect(String(sheet.getCell(1, 26).value)).toBe('Trạng thái');
      let medRow = 0;
      sheet.eachRow((row, n) => {
        if (String(row.getCell(1).value) === `${baseCode}-M`) medRow = n;
      });
      expect(medRow).toBeGreaterThan(1);
      expect(String(sheet.getCell(medRow, 4).value)).toBe(`Viên-${tag}`); // Đơn vị cơ sở = TÊN
      expect(String(sheet.getCell(medRow, 3).value)).toBe('Thuốc');
      expect(String(sheet.getCell(medRow, 13).value)).toBe('Gây nghiện');
      expect(String(sheet.getCell(medRow, 26).value)).toBe('Đang dùng');
      const ing: number[] = [];
      wb.getWorksheet('Hoạt chất')!.eachRow((row) => {
        if (String(row.getCell(1).value) === `${baseCode}-M`) ing.push(Number(row.getCell(3).value));
      });
      expect(ing.sort((a, b) => a - b)).toEqual([62.5, 500]);
      const audit = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'drug.exported' } });
      expect(audit.length).toBeGreaterThanOrEqual(1);

      // Nhập lại đúng file vừa xuất → mọi mặt hàng đều là "Đã có sẵn".
      const again = await upload('preview', clinicAdminToken, res.body as Buffer);
      expect(again.status).toBe(200);
      expect(again.body.data.validRows).toEqual([]);
      expect(again.body.data.errorRows).toEqual([]);
      expect(again.body.data.duplicateRows.length).toBeGreaterThanOrEqual(2);

      // Tenant B chỉ xuất được mặt hàng của chính mình.
      const b = await download('/api/v1/drugs/export', tenantBAdminToken);
      const wbB = await loadWorkbook(b.body as Buffer);
      const codesB: string[] = [];
      wbB.getWorksheet('Thuốc & Vật tư')!.eachRow((row, n) => {
        if (n > 1) codesB.push(String(row.getCell(1).value));
      });
      expect(codesB).toEqual([`${baseCode}-M`]);
    });

    it('lễ tân (có drug.read) xuất được; không token → 401', async () => {
      expect((await download('/api/v1/drugs/export', receptionistToken)).status).toBe(200);
      expect((await request(app.getHttpServer()).get('/api/v1/drugs/export')).status).toBe(401);
    });
  });
});
