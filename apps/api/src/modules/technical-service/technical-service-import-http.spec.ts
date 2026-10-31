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
import type { ImportRecord } from '../../common/excel-import/excel-import';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { buildServiceExportWorkbook } from './technical-service-import.workbook';

/**
 * HTTP e2e "Nhập/Xuất Excel Dịch vụ kỹ thuật" (docs/DECISIONS.md #276) — file Excel dựng THẬT bằng exceljs, đi qua API như người dùng. Trọng tâm: MỌI lỗi khi
 * tải file lên phải nói rõ sheet + dòng + TÊN CỘT + cách sửa (xem preview), lỗi mức file (sai mẫu/không phải xlsx/quá lớn/rỗng) báo 400 tiếng Việt, và commit
 * là "hoặc nhập đủ hoặc không nhập gì".
 */
describe('HTTP e2e — /api/v1/technical-services/import-template|export|import', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';
  /** Gắn vào mọi TÊN do test tạo → dọn được danh mục dùng chung sau cùng. */
  const tag = randomUUID().slice(0, 8);

  let clinicAdminToken: string;
  let doctorToken: string;
  let noManageToken: string;
  let tenantBAdminToken: string;
  let departmentName: string;
  let priceTypeCodeA: string;

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function loginNewUser(tenantId: string, roleId: string) {
    const username = `e2e-tsimp-${randomUUID()}`;
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

  /** Vai trò tuỳ biến CHỈ có `technical_service.create` + `.read` (không `reference_catalog.manage`). */
  async function createNoManageUser(tenantId: string) {
    const role = await privileged.role.create({ data: { tenantId, name: `no-manage-${tag}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    for (const action of ['create', 'read']) {
      const permission = await privileged.permission.findFirstOrThrow({ where: { module: 'technical_service', action } });
      await privileged.rolePermission.create({
        data: { tenantId, roleId: role.id, permissionId: permission.id, dataScope: 'global', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
    }
    return loginNewUser(tenantId, role.id);
  }

  async function addPriceType(tenantId: string, name: string): Promise<string> {
    const code = `PT${tag}`.slice(0, 12);
    await privileged.referenceCatalog.create({
      data: { tenantId, category: 'PRICE_TYPE', code, name, isDefault: true, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return code;
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

  /** Dòng hợp lệ mẫu (xét nghiệm làm tại phòng khám, có giá) — ghi đè từng trường để tạo dòng lỗi. */
  const lab = (name: string, overrides: ImportRecord = {}): ImportRecord => ({
    kind: 'Xét nghiệm',
    name,
    category: `Huyết học-${tag}`,
    specimen: `Máu-${tag}`,
    inHouse: 'Có',
    turnaround: 60,
    resultType: 'Theo chỉ số',
    unit: `Lần-${tag}`,
    price: 80000,
    ...overrides,
  });
  const imaging = (name: string, overrides: ImportRecord = {}): ImportRecord => ({
    kind: 'Chẩn đoán hình ảnh',
    name,
    category: `Siêu âm-${tag}`,
    inHouse: 'Có',
    unit: `Lần-${tag}`,
    price: 150000,
    ...overrides,
  });
  const outside = (name: string, overrides: ImportRecord = {}): ImportRecord => ({ kind: 'Xét nghiệm', name, inHouse: 'Không', ...overrides });

  const xlsx = (rows: ImportRecord[]) => buildServiceExportWorkbook(rows);

  function upload(path: 'preview' | 'commit', token: string, file: Buffer | null) {
    const req = request(app.getHttpServer()).post(`/api/v1/technical-services/import/${path}`).set(authed(token));
    return file ? req.attach('file', file, { filename: 'dich-vu.xlsx' }) : req;
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

    fixture = await createTwoTenantFixture(privileged, 'TechService import e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    noManageToken = await createNoManageUser(fixture.tenantA.id);
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');

    departmentName = `Khoa Xét nghiệm ${tag}`;
    await privileged.department.create({ data: { tenantId: fixture.tenantA.id, name: departmentName, isActive: true, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    priceTypeCodeA = await addPriceType(fixture.tenantA.id, `Thường-${tag}`);
    await addPriceType(fixture.tenantB.id, `Thường-${tag}`);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.referenceCatalog.deleteMany({ where: { name: { contains: tag } } });
    await privileged.$disconnect();
    await app.close();
  });

  describe('file mẫu', () => {
    it('clinic_admin tải file mẫu → sheet nhập + Hướng dẫn + Danh mục hiện có (có Khoa/Phòng), 3 dòng ví dụ tên VD-', async () => {
      const res = await download('/api/v1/technical-services/import-template', clinicAdminToken);
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('mau-nhap-dich-vu-ky-thuat.xlsx');
      const wb = await loadWorkbook(res.body as Buffer);
      expect(wb.worksheets.map((s) => s.name)).toEqual(['Dịch vụ kỹ thuật', 'Hướng dẫn', 'Danh mục hiện có']);
      const sheet = wb.getWorksheet('Dịch vụ kỹ thuật')!;
      expect(String(sheet.getCell(1, 1).value)).toBe('Loại *');
      expect(String(sheet.getCell(1, 9).value)).toBe('Thời gian trả kết quả (phút)');
      expect(String(sheet.getCell(1, 12).value)).toBe('Giá bán *(tại phòng khám)');
      const names: string[] = [];
      sheet.eachRow((row, n) => {
        if (n > 1) names.push(String(row.getCell(2).value));
      });
      expect(names).toHaveLength(3);
      expect(names.every((n) => n.startsWith('VD-'))).toBe(true);
      const catalog = wb.getWorksheet('Danh mục hiện có')!;
      expect(String(catalog.getCell(1, 4).value)).toContain('Khoa/Phòng');
      const deptNames: string[] = [];
      catalog.eachRow((row, n) => {
        if (n > 1) deptNames.push(String(row.getCell(4).value));
      });
      expect(deptNames).toContain(departmentName);
    });

    it('file mẫu tải về rồi nhập lại NGUYÊN VẸN → mọi dòng ví dụ bị bỏ qua, không lỗi, không nhập gì', async () => {
      const template = await download('/api/v1/technical-services/import-template', clinicAdminToken);
      const res = await upload('preview', clinicAdminToken, template.body as Buffer);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ validRows: [], duplicateRows: [], errorRows: [], newCatalogItems: [], exampleRowCount: 3 });
    });

    it('bỏ tiền tố VD- khỏi file mẫu → 3 dịch vụ mẫu ĐỀU hợp lệ (mẫu luôn nhập lại được)', async () => {
      const template = await download('/api/v1/technical-services/import-template', clinicAdminToken);
      const wb = await loadWorkbook(template.body as Buffer);
      const sheet = wb.getWorksheet('Dịch vụ kỹ thuật')!;
      for (let r = 2; r <= 4; r++) sheet.getCell(r, 2).value = String(sheet.getCell(r, 2).value).replace('VD-', `${tag}-`);
      const res = await upload('preview', clinicAdminToken, Buffer.from(await wb.xlsx.writeBuffer()));
      expect(res.status).toBe(200);
      expect(res.body.data.errorRows).toEqual([]);
      expect(res.body.data.validRows).toHaveLength(3);
    });

    it('bác sĩ (không có technical_service.create) → 403 ở file mẫu, preview, commit; không token → 401', async () => {
      expect((await download('/api/v1/technical-services/import-template', doctorToken)).status).toBe(403);
      expect((await upload('preview', doctorToken, await xlsx([lab(`X${tag}`)]))).status).toBe(403);
      expect((await upload('commit', doctorToken, await xlsx([lab(`X${tag}`)]))).status).toBe(403);
      expect((await request(app.getHttpServer()).get('/api/v1/technical-services/import-template')).status).toBe(401);
    });
  });

  describe('xem trước (preview) — báo lỗi để người dùng sửa file', () => {
    it('3 nhóm: hợp lệ + danh mục sẽ tạo mới; KHÔNG ghi dịch vụ/danh mục nào', async () => {
      const before = await privileged.referenceCatalog.count({ where: { name: { contains: tag } } });
      const res = await upload('preview', clinicAdminToken, await xlsx([lab(`CTM ${tag}`), imaging(`Siêu âm bụng ${tag}`, { department: departmentName }), outside(`Gen ${tag}`)]));
      expect(res.status).toBe(200);
      expect(res.body.data.errorRows).toEqual([]);
      expect(res.body.data.validRows.map((r: { name: string; serviceKind: string; price: number | null }) => [r.name, r.serviceKind, r.price])).toEqual([
        [`CTM ${tag}`, 'LAB', 80000],
        [`Siêu âm bụng ${tag}`, 'IMAGING', 150000],
        [`Gen ${tag}`, 'LAB', null],
      ]);
      const created = (res.body.data.newCatalogItems as { category: string; name: string }[]).map((n) => `${n.category}|${n.name}`);
      expect(created).toEqual(expect.arrayContaining([`TECH_SERVICE_CATEGORY|Huyết học-${tag}`, `SPECIMEN_TYPE|Máu-${tag}`, `UNIT|Lần-${tag}`]));
      expect(await privileged.referenceCatalog.count({ where: { name: { contains: tag } } })).toBe(before);
      expect(await privileged.technicalService.count({ where: { tenantId: fixture.tenantA.id, name: { contains: tag } } })).toBe(0);
    });

    it('MỖI lỗi dòng nêu rõ sheet + số dòng + tên dịch vụ + TÊN CỘT + cách sửa; dòng lỗi không vào nhóm hợp lệ, không sinh danh mục mới', async () => {
      const longName = 'N'.repeat(201);
      const rows: ImportRecord[] = [
        lab(`E01 ${tag}`, { kind: 'Siêu âm' }), // loại lạ
        lab(`E02 ${tag}`, { kind: '' }), // thiếu loại
        lab('', { name: '' }), // thiếu tên
        lab(longName), // tên quá dài
        imaging(`E05 ${tag}`, { specimen: `Máu-${tag}` }), // loại mẫu cho CĐHA
        lab(`E06 ${tag}`, { department: `Khoa không có ${tag}` }), // khoa lạ
        lab(`E07 ${tag}`, { inHouse: 'có lẽ' }), // Có/Không sai
        lab(`E08 ${tag}`, { turnaround: 0 }), // thời gian trả sai
        lab(`E09 ${tag}`, { resultType: 'Hình ảnh' }), // kiểu kết quả lạ
        lab(`E10 ${tag}`, { price: '' }), // thiếu giá
        lab(`E11 ${tag}`, { unit: '' }), // thiếu đơn vị
        outside(`E12 ${tag}`, { price: 5000, unit: `Lần-${tag}` }), // ra ngoài mà có giá
        lab(`E13 ${tag}`, { price: 1500.5 }), // giá lẻ
        lab(`E14 ${tag}`, { shortName: 'S'.repeat(101) }), // tên viết tắt dài
        lab(`E15 ${tag}`, { nationalCode: 'M'.repeat(51) }), // mã BYT dài
        lab(`E16 ${tag}`, { category: `Nhóm CHỈ-DÙNG-Ở-DÒNG-LỖI-${tag}` }), // lỗi + danh mục mới chỉ dòng lỗi dùng
        lab(`OK ${tag}`),
        lab(`OK ${tag}`), // lặp trong file
      ];
      const res = await upload('preview', clinicAdminToken, await xlsx(rows));
      expect(res.status).toBe(200);
      const errors = res.body.data.errorRows as { sheet: string; rowNumber: number; name: string; reason: string }[];
      const reasonOf = (namePart: string) => errors.filter((e) => e.name.includes(namePart)).map((e) => e.reason).join(' | ');

      expect(reasonOf('E01')).toContain('Cột "Loại": phải là Xét nghiệm, Chẩn đoán hình ảnh hoặc Thăm dò chức năng');
      expect(reasonOf('E02')).toContain('Cột "Loại": bắt buộc');
      expect(errors.find((e) => e.name === '(trống)')?.reason).toContain('Cột "Tên": bắt buộc');
      expect(errors.some((e) => e.reason.includes('Cột "Tên": tối đa 200 ký tự (hiện 201)'))).toBe(true);
      expect(reasonOf('E05')).toContain('Cột "Loại mẫu": chỉ dùng cho Xét nghiệm');
      expect(reasonOf('E06')).toContain('Cột "Khoa/Phòng thực hiện": không có khoa/phòng');
      expect(reasonOf('E07')).toContain('Cột "Làm tại phòng khám": phải là Có hoặc Không');
      expect(reasonOf('E08')).toContain('Cột "Thời gian trả kết quả": phải là số nguyên dương');
      expect(reasonOf('E09')).toContain('Cột "Kiểu kết quả": phải là Theo chỉ số');
      expect(reasonOf('E10')).toContain('Cột "Giá bán": bắt buộc khi làm tại phòng khám');
      expect(reasonOf('E11')).toContain('Cột "Đơn vị tính": bắt buộc khi làm tại phòng khám');
      expect(reasonOf('E12')).toContain('Cột "Giá bán": dịch vụ chỉ định ra ngoài');
      expect(reasonOf('E13')).toContain('Cột "Giá bán": phải là số nguyên không âm');
      expect(reasonOf('E14')).toContain('Cột "Tên viết tắt": tối đa 100 ký tự');
      expect(reasonOf('E15')).toContain('Cột "Mã BYT": tối đa 50 ký tự');
      // Mỗi lỗi ghi đúng tên sheet và số dòng (dòng 1 là tiêu đề → dòng dữ liệu đầu là 2).
      expect(errors.find((e) => e.name.includes('E01'))).toMatchObject({ sheet: 'Dịch vụ kỹ thuật', rowNumber: 2 });
      expect(errors.find((e) => e.name.includes('E10'))?.rowNumber).toBe(11);
      // Lần xuất hiện ĐẦU của tên lặp vẫn hợp lệ; chỉ dòng lặp sau là lỗi.
      expect(res.body.data.validRows.map((r: { name: string }) => r.name)).toEqual([`E16 ${tag}`, `OK ${tag}`]);
      expect(errors.some((e) => e.name === `OK ${tag}` && e.rowNumber === 19 && e.reason.includes('dịch vụ bị lặp trong file (cùng Loại + Tên với dòng 18)'))).toBe(true);
    });

    it('lỗi mức FILE báo 400 tiếng Việt: sai tiêu đề cột / không phải xlsx / thiếu file / quá 2.000 dịch vụ', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Dịch vụ kỹ thuật').addRow(['Cột lạ', 'Tên']);
      const wrongHeader = await upload('preview', clinicAdminToken, Buffer.from(await wb.xlsx.writeBuffer()));
      expect(wrongHeader.status).toBe(400);
      expect(wrongHeader.body.error.message).toContain('không đúng mẫu');
      expect(wrongHeader.body.error.message).toContain('Loại');

      const notExcel = await upload('preview', clinicAdminToken, Buffer.from('đây không phải file excel'));
      expect(notExcel.status).toBe(400);
      expect(notExcel.body.error.message).toContain('Không đọc được file');

      const noFile = await upload('preview', clinicAdminToken, null);
      expect(noFile.status).toBe(400);
      expect(noFile.body.error.message).toContain('Thiếu file');

      const tooMany = Array.from({ length: 2001 }, (_, i) => outside(`Quá nhiều ${tag}-${i}`));
      const big = await upload('preview', clinicAdminToken, await xlsx(tooMany));
      expect(big.status).toBe(400);
      expect(big.body.error.message).toContain('tối đa 2.000 dịch vụ');
    }, 120_000);

    it('file chỉ có dòng tiêu đề (không có dòng dữ liệu) → preview rỗng hợp lệ để giao diện báo "file không có dòng nào"', async () => {
      const res = await upload('preview', clinicAdminToken, await xlsx([]));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ validRows: [], duplicateRows: [], errorRows: [], newCatalogItems: [], exampleRowCount: 0 });
    });

    it('vai trò có technical_service.create nhưng KHÔNG có reference_catalog.manage: tên danh mục chưa có → lỗi dòng nêu rõ cột, không tạo gì', async () => {
      const res = await upload('preview', noManageToken, await xlsx([lab(`NM ${tag}`, { category: `Nhóm mới NM-${tag}` })]));
      expect(res.status).toBe(200);
      expect(res.body.data.validRows).toEqual([]);
      expect(res.body.data.errorRows[0].reason).toContain('Cột "Nhóm dịch vụ"');
      expect(res.body.data.errorRows[0].reason).toContain('không có quyền tạo mới danh mục dùng chung');
      expect(res.body.data.newCatalogItems).toEqual([]);
    });

    it('phòng khám chưa có Loại giá nào: dòng có giá báo lỗi cột Giá bán, dòng ra ngoài vẫn hợp lệ', async () => {
      await privileged.referenceCatalog.deleteMany({ where: { tenantId: fixture.tenantB.id, category: 'PRICE_TYPE' } });
      const res = await upload('preview', tenantBAdminToken, await xlsx([lab(`NP ${tag}`), outside(`NP2 ${tag}`)]));
      expect(res.status).toBe(200);
      expect(res.body.data.validRows.map((r: { name: string }) => r.name)).toEqual([`NP2 ${tag}`]);
      expect(res.body.data.errorRows[0].reason).toContain('chưa có Loại giá dịch vụ nào');
      await addPriceType(fixture.tenantB.id, `Thường-${tag}`);
    });
  });

  describe('nhập thật (commit) + xuất lại', () => {
    it('commit: tạo dịch vụ đủ mã tự sinh theo loại, đơn giá gốc (Loại giá mặc định, hôm nay), khoa, mặc định kiểu kết quả; dịch vụ ra ngoài không có giá; danh mục mới', async () => {
      const file = await xlsx([
        lab(`Công thức máu ${tag}`, { shortName: 'CTM', nationalCode: '123.45', department: departmentName }),
        imaging(`Siêu âm bụng ${tag}`),
        { kind: 'Thăm dò chức năng', name: `Điện tim ${tag}`, inHouse: '', unit: `Lần-${tag}`, price: 70000, resultType: 'Cả hai' },
        outside(`Xét nghiệm gen ${tag}`, { category: `Sinh học PT-${tag}` }),
      ]);
      const res = await upload('commit', clinicAdminToken, file);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ createdCount: 4, duplicateCount: 0, errorCount: 0 });
      expect(res.body.data.newCatalogItemCount).toBeGreaterThanOrEqual(5);

      const list = await request(app.getHttpServer()).get('/api/v1/technical-services').query({ search: tag }).set(authed(clinicAdminToken));
      const items = list.body.data.items as {
        code: string; name: string; shortName: string | null; nationalCode: string | null; serviceKind: string; isPerformedInHouse: boolean; resultType: string;
        departmentName: string | null; turnaroundMinutes: number | null; categoryCode: string | null; specimenTypeCode: string | null; currentPrices: { priceTypeCode: string; unitCode: string; amount: number }[];
      }[];
      const byName = (part: string) => items.find((i) => i.name.includes(part))!;
      const ctm = byName('Công thức máu');
      expect(ctm).toMatchObject({ shortName: 'CTM', nationalCode: '123.45', serviceKind: 'LAB', isPerformedInHouse: true, resultType: 'INDICATORS', departmentName, turnaroundMinutes: 60 });
      expect(ctm.code).toMatch(/^XN/);
      expect(ctm.currentPrices).toEqual([{ priceTypeCode: priceTypeCodeA, unitCode: expect.stringMatching(/^DV/), amount: 80000 }]);
      expect(byName('Siêu âm bụng')).toMatchObject({ serviceKind: 'IMAGING', resultType: 'NARRATIVE', specimenTypeCode: null });
      expect(byName('Siêu âm bụng').code).toMatch(/^CD/);
      const ecg = byName('Điện tim');
      expect(ecg).toMatchObject({ serviceKind: 'FUNCTIONAL', isPerformedInHouse: true, resultType: 'BOTH' });
      expect(ecg.code).toMatch(/^TD/);
      expect(byName('Xét nghiệm gen')).toMatchObject({ isPerformedInHouse: false, currentPrices: [] });

      // Mã danh mục là mã THẬT do hệ thống sinh, đúng danh mục, đúng công ty.
      const unitRow = await privileged.referenceCatalog.findFirst({ where: { tenantId: fixture.tenantA.id, category: 'UNIT', code: ctm.currentPrices[0]!.unitCode } });
      expect(unitRow?.name).toBe(`Lần-${tag}`);
      const categoryRow = await privileged.referenceCatalog.findFirst({ where: { tenantId: fixture.tenantA.id, category: 'TECH_SERVICE_CATEGORY', code: ctm.categoryCode! } });
      expect(categoryRow?.name).toBe(`Huyết học-${tag}`);

      const audit = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: { in: ['technical_service.imported', 'technical_service.created'] } } });
      expect(audit.some((a) => a.action === 'technical_service.imported')).toBe(true);
      expect(audit.filter((a) => a.action === 'technical_service.created').length).toBeGreaterThanOrEqual(4);
    });

    it('nhập lại CÙNG file (kể cả tên khác hoa/thường/dấu) → "Đã có sẵn", không tạo thêm gì, không ghi đè', async () => {
      const beforeCatalog = await privileged.referenceCatalog.count({ where: { name: { contains: tag } } });
      const beforeServices = await privileged.technicalService.count({ where: { tenantId: fixture.tenantA.id, name: { contains: tag } } });
      const file = await xlsx([lab(`CONG THUC MAU ${tag}`, { shortName: 'KHÁC — không được ghi đè', price: 1 }), imaging(`Siêu âm bụng ${tag}`)]);
      const preview = await upload('preview', clinicAdminToken, file);
      expect(preview.body.data.duplicateRows.map((r: { name: string }) => r.name)).toEqual([`CONG THUC MAU ${tag}`, `Siêu âm bụng ${tag}`]);
      expect(preview.body.data.validRows).toEqual([]);
      expect(preview.body.data.errorRows).toEqual([]);
      const commit = await upload('commit', clinicAdminToken, file);
      expect(commit.body.data).toMatchObject({ createdCount: 0, duplicateCount: 2, errorCount: 0, newCatalogItemCount: 0 });
      expect(await privileged.referenceCatalog.count({ where: { name: { contains: tag } } })).toBe(beforeCatalog);
      expect(await privileged.technicalService.count({ where: { tenantId: fixture.tenantA.id, name: { contains: tag } } })).toBe(beforeServices);
      const ctm = await privileged.technicalService.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, name: `Công thức máu ${tag}` } });
      expect(ctm.shortName).toBe('CTM');
    });

    it('cùng TÊN nhưng khác LOẠI không bị coi là trùng (khoá nhận diện = Loại + Tên)', async () => {
      const res = await upload('preview', clinicAdminToken, await xlsx([imaging(`Công thức máu ${tag}`)]));
      expect(res.body.data.duplicateRows).toEqual([]);
      expect(res.body.data.validRows).toHaveLength(1);
    });

    it('commit file lẫn hợp lệ + lỗi → CHỈ nhập dòng hợp lệ; danh mục mới chỉ của dịch vụ hợp lệ', async () => {
      const before = await privileged.referenceCatalog.count({ where: { name: { contains: `LOI-${tag}` } } });
      const file = await xlsx([lab(`Mix OK ${tag}`), lab(`Mix lỗi ${tag}`, { price: 'abc', category: `Nhóm LOI-${tag}` })]);
      const res = await upload('commit', clinicAdminToken, file);
      expect(res.body.data).toMatchObject({ createdCount: 1, errorCount: 1 });
      expect(await privileged.technicalService.count({ where: { tenantId: fixture.tenantA.id, name: `Mix OK ${tag}` } })).toBe(1);
      expect(await privileged.technicalService.count({ where: { tenantId: fixture.tenantA.id, name: `Mix lỗi ${tag}` } })).toBe(0);
      expect(await privileged.referenceCatalog.count({ where: { name: { contains: `LOI-${tag}` } } })).toBe(before);
    });

    it('nhập 300 dịch vụ trong 1 lần (1 transaction) thành công', async () => {
      const rows = Array.from({ length: 300 }, (_, i) => outside(`Bulk ${tag}-${i}`));
      const res = await upload('commit', clinicAdminToken, await xlsx(rows));
      expect(res.status).toBe(200);
      expect(res.body.data.createdCount).toBe(300);
      expect(await privileged.technicalService.count({ where: { tenantId: fixture.tenantA.id, name: { startsWith: `Bulk ${tag}-` } } })).toBe(300);
    }, 120_000);

    it('cách ly tenant: tenant B nhập CÙNG tên không bị coi là trùng với tenant A', async () => {
      const file = await xlsx([imaging(`Siêu âm bụng ${tag}`)]);
      const preview = await upload('preview', tenantBAdminToken, file);
      expect(preview.body.data.duplicateRows).toEqual([]);
      expect(preview.body.data.validRows.map((r: { name: string }) => r.name)).toEqual([`Siêu âm bụng ${tag}`]);
    });

    it('xuất Excel: đủ cột theo TÊN danh mục (không phải mã), giá đang hiệu lực, trạng thái, ghi audit; nhập lại file xuất → toàn bộ "Đã có sẵn"; bác sĩ xuất được, không token 401', async () => {
      const res = await download('/api/v1/technical-services/export', doctorToken); // technical_service.read là đủ
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('danh-muc-dich-vu-ky-thuat.xlsx');
      const wb = await loadWorkbook(res.body as Buffer);
      const sheet = wb.getWorksheet('Dịch vụ kỹ thuật')!;
      expect(String(sheet.getCell(1, 13).value)).toBe('Trạng thái');
      let row = 0;
      sheet.eachRow((r, n) => {
        if (String(r.getCell(2).value) === `Công thức máu ${tag}`) row = n;
      });
      expect(row).toBeGreaterThan(1);
      expect(String(sheet.getCell(row, 1).value)).toBe('Xét nghiệm');
      expect(String(sheet.getCell(row, 5).value)).toBe(`Huyết học-${tag}`);
      expect(String(sheet.getCell(row, 6).value)).toBe(`Máu-${tag}`);
      expect(String(sheet.getCell(row, 8).value)).toBe(departmentName);
      expect(String(sheet.getCell(row, 11).value)).toBe(`Lần-${tag}`);
      expect(Number(sheet.getCell(row, 12).value)).toBe(80000);
      expect(String(sheet.getCell(row, 13).value)).toBe('Đang dùng');
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'technical_service.exported' } })).toBeGreaterThanOrEqual(1);

      const again = await upload('preview', clinicAdminToken, res.body as Buffer);
      expect(again.status).toBe(200);
      expect(again.body.data.validRows).toEqual([]);
      expect(again.body.data.errorRows).toEqual([]);
      expect(again.body.data.duplicateRows.length).toBeGreaterThanOrEqual(4);

      expect((await request(app.getHttpServer()).get('/api/v1/technical-services/export')).status).toBe(401);
    });

    it('xuất công ty A rồi nhập sang công ty B: dịch vụ, nhóm/mẫu/đơn vị theo TÊN và giá sang đủ (khoa không có ở B thì dòng đó báo lỗi cột Khoa/Phòng)', async () => {
      const exported = await download('/api/v1/technical-services/export', clinicAdminToken);
      const res = await upload('commit', tenantBAdminToken, exported.body as Buffer);
      expect(res.status).toBe(200);
      const inB = await privileged.technicalService.findFirstOrThrow({ where: { tenantId: fixture.tenantB.id, name: `Siêu âm bụng ${tag}` }, include: { prices: { where: { deletedAt: null } } } });
      expect(inB.prices.map((p) => Number(p.amount))).toEqual([150000]);
      // "Công thức máu" của A gắn khoa chỉ có ở A → ở B bị từ chối đúng cột, các dòng còn lại vẫn nhập.
      expect(await privileged.technicalService.count({ where: { tenantId: fixture.tenantB.id, name: `Công thức máu ${tag}` } })).toBe(0);
      expect(res.body.data.errorCount).toBeGreaterThanOrEqual(1);
    }, 120_000);
  });
});
