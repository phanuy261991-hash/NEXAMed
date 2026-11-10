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

/**
 * HTTP e2e — Nhập/Xuất Excel "Giá trả đối tác" (docs/DECISIONS.md #291 GĐ4, mockup chốt 10/11/2026). Bao phủ: file mẫu/file xuất (cột từng đối tác đang dùng, tên đối tác có ngoặc, dòng ví dụ, ba sheet,
 * nhật ký xuất), xuất rồi nhập lại → toàn ô "giữ nguyên", xem trước + ghi (đổi giá, thêm mới, đổi đối tác mặc định, ô trống giữ nguyên, giá cũ được thay), lỗi từng dòng (dịch vụ không có/chưa
 * "Gửi đối tác", giá không phải số, đối tác mặc định chưa có giá, dòng lặp) và KHÔNG ghi gì khi còn lỗi, cột đối tác không còn dùng bị bỏ qua, lỗi mức file, quyền (chỉ quyền sửa dịch vụ kỹ thuật),
 * công tắc tắt → 409, cô lập công ty.
 */
describe('HTTP e2e — /api/v1/lab-partners/price-import (Excel giá trả đối tác)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const http = () => request(app.getHttpServer());
  const BASE = '/api/v1/lab-partners/price-import';
  const SHEET = 'Giá trả đối tác';

  let p1: { id: string; code: string; name: string };
  let p2: { id: string; code: string; name: string };
  let p3: { id: string; code: string; name: string }; // tên có ngoặc và dấu *
  let svcA: { id: string; name: string }; // P1 150.000 (mặc định), P2 135.000
  let svcB: { id: string; name: string }; // P1 90.000 (mặc định), P3 70.000
  let svcPlain: { id: string; name: string }; // xét nghiệm KHÔNG gửi đối tác

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-lppi-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  async function setToggle(token: string, value: boolean) {
    const res = await http().patch('/api/v1/clinic-settings').set(authed(token)).send({ labPartnerEnabled: value });
    expect(res.status).toBe(200);
  }

  async function createPartner(name: string) {
    const res = await http().post('/api/v1/suppliers').set(authed(adminToken)).send({ name, isLabPartner: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { id: res.body.data.id as string, code: res.body.data.code as string, name };
  }

  async function createService(name: string, body: Record<string, unknown>) {
    const res = await http()
      .post('/api/v1/technical-services')
      .set(authed(adminToken))
      .send({ name, serviceKind: 'LAB', isPerformedInHouse: true, prices: [{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 200_000, effectiveFrom: '2020-01-01' }], ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { id: res.body.data.id as string, name };
  }

  /** Dựng file .xlsx từ tiêu đề + các dòng (ô null = trống). */
  async function makeFile(header: string[], rows: (string | number | null)[][], sheetName = SHEET): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(sheetName);
    sheet.addRow(header);
    for (const r of rows) sheet.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const binary = (res: request.Response, cb: (err: Error | null, body: unknown) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };
  const download = (path: string, token: string) => http().get(`${BASE}/${path}`).set(authed(token)).buffer(true).parse(binary);
  const preview = (file: Buffer, token = adminToken) => http().post(`${BASE}/preview`).set(authed(token)).attach('file', file, 'gia-tra.xlsx');
  const commit = (file: Buffer, token = adminToken) => http().post(`${BASE}/commit`).set(authed(token)).attach('file', file, 'gia-tra.xlsx');
  const loadSheet = async (buffer: Buffer, name = SHEET): Promise<ExcelJS.Worksheet> => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb.getWorksheet(name)!;
  };
  const headerOf = (sheet: ExcelJS.Worksheet): string[] => (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => String(v ?? ''));
  const hdr = (p: { code: string; name: string }) => `Giá trả [${p.code}] ${p.name.replace(/[*()]/g, ' ').replace(/\s+/g, ' ').trim()}`;
  const activePrices = (serviceId: string) => privileged.labPartnerServicePrice.findMany({ where: { tenantId: fixture.tenantA.id, technicalServiceId: serviceId, deletedAt: null } });

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

    fixture = await createTwoTenantFixture(privileged, 'Lab partner price import e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');

    await setToggle(adminToken, true);
    p1 = await createPartner('Phòng XN Một');
    p2 = await createPartner('Phòng XN Hai');
    p3 = await createPartner('Phòng Lab (Quận 1)*');
    svcA = await createService('XN giá trả A', {
      sentToPartner: true,
      partnerPrices: [
        { supplierId: p1.id, amount: 150_000, isDefault: true },
        { supplierId: p2.id, amount: 135_000 },
      ],
    });
    svcB = await createService('XN giá trả B', {
      sentToPartner: true,
      partnerPrices: [
        { supplierId: p1.id, amount: 90_000, isDefault: true },
        { supplierId: p3.id, amount: 70_000 },
      ],
    });
    svcPlain = await createService('XN không gửi đối tác', {});
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('file mẫu và file xuất: cột từng đối tác đang dùng, tên có ngoặc được làm sạch, chỉ dịch vụ gửi đối tác, dòng ví dụ chỉ ở file mẫu, ba sheet, nhật ký xuất', async () => {
    const tpl = await download('template', adminToken);
    expect(tpl.status).toBe(200);
    expect(tpl.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual([SHEET, 'Hướng dẫn', 'Danh mục hiện có']);
    const sheet = wb.getWorksheet(SHEET)!;
    expect(headerOf(sheet).slice(0, 3)).toEqual(['Loại *', 'Tên dịch vụ *', 'Đối tác mặc định']);
    const partnerHeaders = headerOf(sheet).slice(3);
    expect(partnerHeaders).toHaveLength(3);
    expect(partnerHeaders).toContain(hdr(p1));
    expect(partnerHeaders).toContain(hdr(p2));
    expect(partnerHeaders).toContain(`Giá trả [${p3.code}] Phòng Lab Quận 1`); // bỏ ngoặc và dấu *
    const names = [] as string[];
    sheet.eachRow((row, n) => {
      if (n > 1) names.push(String(row.getCell(2).value));
    });
    expect(names.filter((n) => n.startsWith('VD-'))).toHaveLength(1);
    expect(names).toContain(svcA.name);
    expect(names).toContain(svcB.name);
    expect(names).not.toContain(svcPlain.name);

    const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'technical_service.partner_prices_exported' } });
    const exp = await download('export', adminToken);
    expect(exp.status).toBe(200);
    const exportSheet = await loadSheet(exp.body as Buffer);
    const exportNames = [] as string[];
    exportSheet.eachRow((row, n) => {
      if (n > 1) exportNames.push(String(row.getCell(2).value));
    });
    expect(exportNames.sort()).toEqual([svcA.name, svcB.name].sort());
    expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'technical_service.partner_prices_exported' } })).toBe(before + 1);

    // Xuất rồi nhập lại: không lỗi, mọi ô giá đều "giữ nguyên".
    const roundTrip = await preview(exp.body as Buffer);
    expect(roundTrip.status, JSON.stringify(roundTrip.body)).toBe(200);
    expect(roundTrip.body.data.errorRows).toEqual([]);
    expect(roundTrip.body.data.ignoredColumns).toEqual([]);
    const changes = roundTrip.body.data.changes as { result: string; serviceName: string; partnerName: string }[];
    expect(changes).toHaveLength(4);
    expect(changes.every((c) => c.result === 'SAME')).toBe(true);
    expect(changes.some((c) => c.partnerName === p3.name)).toBe(true);
    expect(roundTrip.body.data.defaultChangeCount).toBe(0);
  });

  it('xem trước rồi ghi: đổi giá, thêm mới, đổi đối tác mặc định; ô trống và giá không nhắc tới giữ nguyên; giá cũ được thay; nhật ký', async () => {
    const header = ['Loại *', 'Tên dịch vụ *', 'Đối tác mặc định', hdr(p1), hdr(p2), hdr(p3)];
    const file = await makeFile(header, [
      ['Xét nghiệm', svcA.name, p2.name, 155_000, null, null], // đổi giá P1, đặt P2 làm mặc định
      ['Xét nghiệm', svcB.name, null, 90_000, 235_000, null], // P1 trùng giá, thêm mới P2, giữ mặc định
      ['Xét nghiệm', 'VD-Dòng ví dụ', null, 1, null, null], // bỏ qua
    ]);
    const pre = await preview(file);
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect(pre.body.data).toMatchObject({ errorRows: [], defaultChangeCount: 1, serviceRowCount: 2, exampleRowCount: 1, ignoredColumns: [] });
    const changes = pre.body.data.changes as { serviceName: string; partnerCode: string; currentAmount: number | null; newAmount: number; result: string }[];
    const find = (service: string, partner: { code: string }) => changes.find((c) => c.serviceName === service && c.partnerCode === partner.code)!;
    expect(find(svcA.name, p1)).toMatchObject({ currentAmount: 150_000, newAmount: 155_000, result: 'CHANGE' });
    expect(find(svcB.name, p1)).toMatchObject({ currentAmount: 90_000, newAmount: 90_000, result: 'SAME' });
    expect(find(svcB.name, p2)).toMatchObject({ currentAmount: null, newAmount: 235_000, result: 'ADD' });
    expect(pre.body.data.blankCellCount).toBe(3); // dịch vụ A: ô P2 và P3 trống; dịch vụ B: ô P3 trống
    // Xem trước KHÔNG ghi gì.
    expect((await activePrices(svcA.id)).find((p) => p.supplierId === p1.id)!.amount).toBe(150_000n);

    const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'technical_service.partner_prices_imported' } });
    const done = await commit(file);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toEqual({ updatedPriceCount: 2, updatedServiceCount: 2, defaultChangeCount: 1 });

    const aPrices = await activePrices(svcA.id);
    expect(aPrices.map((p) => [p.supplierId, Number(p.amount), p.isDefault]).sort()).toEqual(
      [
        [p1.id, 155_000, false],
        [p2.id, 135_000, true], // không nhắc tới giá P2 → giữ nguyên, nhưng thành mặc định
      ].sort(),
    );
    const bPrices = await activePrices(svcB.id);
    expect(bPrices.map((p) => [p.supplierId, Number(p.amount), p.isDefault]).sort()).toEqual(
      [
        [p1.id, 90_000, true], // giữ mặc định cũ
        [p2.id, 235_000, false],
        [p3.id, 70_000, false], // cột P3 để trống → giữ nguyên
      ].sort(),
    );
    // Giá cũ được xoá mềm, không xoá cứng.
    const replaced = await privileged.labPartnerServicePrice.count({ where: { tenantId: fixture.tenantA.id, technicalServiceId: svcA.id, deletedAt: { not: null } } });
    expect(replaced).toBeGreaterThanOrEqual(2);
    expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'technical_service.partner_prices_imported' } })).toBe(before + 1);

    // Ghi lần hai cùng file: không còn gì đổi (giá và mặc định đã khớp).
    const again = await commit(file);
    expect(again.body.data).toEqual({ updatedPriceCount: 0, updatedServiceCount: 0, defaultChangeCount: 0 });
  });

  it('lỗi từng dòng nêu cột + cách sửa, và còn lỗi thì KHÔNG ghi gì (cả xem trước lẫn ghi)', async () => {
    const header = ['Loại *', 'Tên dịch vụ *', 'Đối tác mặc định', hdr(p1), hdr(p2), hdr(p3)];
    const beforeA = (await activePrices(svcA.id)).map((p) => [p.supplierId, Number(p.amount), p.isDefault]).sort();
    const file = await makeFile(header, [
      ['Xét nghiệm', 'Dịch vụ không tồn tại', null, 1000, null, null], // không có dịch vụ
      ['Xét nghiệm', svcPlain.name, null, 1000, null, null], // chưa bật Gửi đối tác
      ['Xét nghiệm', svcA.name, null, 'abc', -5, null], // giá không phải số, giá âm
      ['Xét nghiệm', svcB.name, 'Đối tác lạ', null, null, null], // đối tác mặc định không có
      ['Xét nghiệm', svcB.name, null, 1000, null, null], // dòng lặp với dòng trên
      ['Chẩn đoán hình ảnh', 'Siêu âm bụng', null, 1000, null, null], // loại hợp lệ nhưng không có dịch vụ
      ['Linh tinh', svcA.name, null, 1000, null, null], // Loại sai
    ]);
    const pre = await preview(file);
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    const errors = pre.body.data.errorRows as { sheet: string; rowNumber: number; name: string; reason: string }[];
    const reasonAt = (row: number) => errors.filter((e) => e.rowNumber === row).map((e) => e.reason).join(' | ');
    expect(errors.every((e) => e.sheet === SHEET)).toBe(true);
    expect(reasonAt(2)).toContain('không có dịch vụ "Dịch vụ không tồn tại"');
    expect(reasonAt(3)).toContain('chưa đặt "Gửi đối tác"');
    expect(reasonAt(4)).toContain(`Giá trả [${p1.code}]`);
    expect(reasonAt(4)).toContain('"abc" không phải số');
    expect(reasonAt(5)).toContain('Đối tác mặc định');
    expect(reasonAt(5)).toContain('không có đối tác "Đối tác lạ"');
    expect(reasonAt(6)).toContain('bị lặp trong file');
    expect(reasonAt(7)).toContain('không có dịch vụ "Siêu âm bụng"');
    expect(reasonAt(8)).toContain('Cột "Loại"');
    expect(reasonAt(4)).toContain(`Giá trả [${p2.code}]`);
    expect(reasonAt(4)).toContain('"-5" không phải số');
    expect(pre.body.data.changes).toEqual([]); // còn lỗi → không liệt kê thay đổi
    expect(pre.body.data.defaultChangeCount).toBe(0);

    const done = await commit(file);
    expect(done.status).toBe(422);
    expect(JSON.stringify(done.body)).toContain('còn');
    expect((await activePrices(svcA.id)).map((p) => [p.supplierId, Number(p.amount), p.isDefault]).sort()).toEqual(beforeA);
  });

  it('đối tác mặc định phải có giá; cột đối tác không còn dùng bị bỏ qua; ghi đối tác mặc định mới cùng giá mới', async () => {
    const p4 = await createPartner('Phòng XN Bốn');
    const stoppedPartner = await createPartner('Phòng XN Đã Ngưng');
    const stop = await http().get('/api/v1/suppliers').set(authed(adminToken));
    const stoppedRow = (stop.body.data.items as { id: string; version: number }[]).find((s) => s.id === stoppedPartner.id)!;
    const stopped = await http().patch(`/api/v1/suppliers/${stoppedPartner.id}`).set(authed(adminToken)).send({ version: stoppedRow.version, isActive: false });
    expect(stopped.status, JSON.stringify(stopped.body)).toBe(200);

    const header = ['Loại *', 'Tên dịch vụ *', 'Đối tác mặc định', hdr(p1), hdr(p4), hdr(stoppedPartner), 'Cột lạ', `Giá trả [DT9999999] Không tồn tại`];
    // Đối tác mặc định P4 chưa có giá và ô P4 trống → lỗi.
    const bad = await preview(await makeFile(header, [['Xét nghiệm', svcA.name, p4.name, null, null, 5000, 'x', 7000]]));
    expect(bad.status).toBe(200);
    expect((bad.body.data.errorRows as { reason: string }[]).map((e) => e.reason).join(' ')).toContain(`đối tác "${p4.name}" chưa có giá`);
    expect(bad.body.data.ignoredColumns).toEqual(expect.arrayContaining([hdr(stoppedPartner), 'Cột lạ', 'Giá trả [DT9999999] Không tồn tại']));

    // Có giá P4 ngay trong file → hợp lệ; P4 thành mặc định.
    const good = await makeFile(header, [['Xét nghiệm', svcA.name, p4.name, null, 99_000, 5000, null, null]]);
    const done = await commit(good);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toEqual({ updatedPriceCount: 1, updatedServiceCount: 1, defaultChangeCount: 1 });
    const prices = await activePrices(svcA.id);
    expect(prices.find((p) => p.supplierId === p4.id)).toMatchObject({ isDefault: true });
    expect(Number(prices.find((p) => p.supplierId === p4.id)!.amount)).toBe(99_000);
    expect(prices.filter((p) => p.isDefault)).toHaveLength(1);
    expect(prices.some((p) => p.supplierId === stoppedPartner.id)).toBe(false); // đối tác đã ngưng không nhận giá từ file
  });

  it('lỗi mức file: không phải .xlsx, sai tiêu đề ba cột đầu, cột đối tác bị lặp, thiếu tệp → 400', async () => {
    const notExcel = await http().post(`${BASE}/preview`).set(authed(adminToken)).attach('file', Buffer.from('không phải excel'), 'x.xlsx');
    expect(notExcel.status).toBe(400);
    const wrongHeader = await preview(await makeFile(['Tên', 'Loại', 'Đối tác mặc định', hdr(p1)], [['a', 'b', null, 1]]));
    expect(wrongHeader.status).toBe(400);
    expect(JSON.stringify(wrongHeader.body)).toContain('file không đúng mẫu');
    const dupCol = await preview(await makeFile(['Loại *', 'Tên dịch vụ *', 'Đối tác mặc định', hdr(p1), hdr(p1)], [['Xét nghiệm', svcA.name, null, 1, 2]]));
    expect(dupCol.status).toBe(400);
    expect(JSON.stringify(dupCol.body)).toContain('bị lặp');
    expect((await http().post(`${BASE}/preview`).set(authed(adminToken))).status).toBe(400);
    expect((await http().post(`${BASE}/commit`).set(authed(adminToken))).status).toBe(400);
  });

  it('quyền: chỉ người có quyền sửa dịch vụ kỹ thuật (bác sĩ/lễ tân 403, không token 401); công tắc tắt → 409; công ty khác không thấy dịch vụ của công ty này', async () => {
    const file = await makeFile(['Loại *', 'Tên dịch vụ *', 'Đối tác mặc định', hdr(p1)], [['Xét nghiệm', svcA.name, null, 1000]]);
    for (const token of [doctorToken, receptionistToken]) {
      expect((await download('template', token)).status).toBe(403);
      expect((await download('export', token)).status).toBe(403);
      expect((await preview(file, token)).status).toBe(403);
      expect((await commit(file, token)).status).toBe(403);
    }
    expect((await http().get(`${BASE}/template`)).status).toBe(401);
    expect((await http().post(`${BASE}/preview`).attach('file', file, 'x.xlsx')).status).toBe(401);

    // Công ty B (bật công tắc): file của A cho ra "không có dịch vụ", và file mẫu của B không có dịch vụ của A.
    await setToggle(tenantBAdminToken, true);
    const crossPreview = await preview(file, tenantBAdminToken);
    expect(crossPreview.status).toBe(200);
    expect((crossPreview.body.data.errorRows as { reason: string }[]).some((e) => e.reason.includes('không có dịch vụ'))).toBe(true);
    const crossCommit = await commit(file, tenantBAdminToken);
    expect(crossCommit.status).toBe(422);
    const tplB = await loadSheet((await download('template', tenantBAdminToken)).body as Buffer);
    const tplBNames = [] as string[];
    tplB.eachRow((row, n) => {
      if (n > 1) tplBNames.push(String(row.getCell(2).value));
    });
    expect(tplBNames.some((n) => n === svcA.name)).toBe(false);

    await setToggle(adminToken, false);
    expect((await download('template', adminToken)).status).toBe(409);
    expect((await download('export', adminToken)).status).toBe(409);
    expect((await preview(file)).status).toBe(409);
    expect((await commit(file)).status).toBe(409);
    await setToggle(adminToken, true);
    expect((await preview(file)).status).toBe(200);
  });
});
