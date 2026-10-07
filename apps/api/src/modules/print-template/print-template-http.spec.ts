import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { buildDefaultPrintTemplateConfig, type PrintTemplate, type ResolvedPrintTemplate } from '@nexamed/shared';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/** HTTP e2e "Quản lý mẫu in" (docs/DECISIONS.md #211). */
describe('HTTP e2e — /api/v1/print-templates', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const API = '/api/v1/print-templates';

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-print-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  async function list(token: string): Promise<PrintTemplate[]> {
    const res = await request(app.getHttpServer()).get(API).set(authed(token));
    expect(res.status).toBe(200);
    return res.body.data.items;
  }

  async function resolved(token: string): Promise<ResolvedPrintTemplate[]> {
    const res = await request(app.getHttpServer()).get(`${API}/resolved`).set(authed(token));
    expect(res.status).toBe(200);
    return res.body.data.items;
  }

  const ofType = (items: PrintTemplate[], documentType: string) => items.filter((i) => i.documentType === documentType);

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

    fixture = await createTwoTenantFixture(privileged, 'Print template e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không token → 401; bác sĩ/lễ tân không có clinic_config.read → 403 ở danh sách quản lý', async () => {
    expect((await request(app.getHttpServer()).get(API)).status).toBe(401);
    expect((await request(app.getHttpServer()).get(API).set(authed(doctorToken))).status).toBe(403);
    expect((await request(app.getHttpServer()).get(API).set(authed(receptionistToken))).status).toBe(403);
  });

  it('danh sách kèm DANH MỤC TĨNH (loại chứng từ, khổ giấy, cấu hình mặc định từng khổ) — web không import giá trị từ shared nên lấy qua API', async () => {
    const res = await request(app.getHttpServer()).get(API).set(authed(adminToken));
    const { catalog } = res.body.data;
    expect(catalog.documentTypes).toHaveLength(13);
    expect(catalog.papers.map((p: { paperSize: string }) => p.paperSize)).toEqual(['A4', 'A5', 'A5_LANDSCAPE', 'K80']);
    expect(catalog.papers.find((p: { paperSize: string }) => p.paperSize === 'K80')).toMatchObject({ widthMm: 80, heightMm: null });
    expect(catalog.defaultConfigs.A4).toEqual(buildDefaultPrintTemplateConfig('A4'));
    const k80Types = catalog.documentTypes.filter((d: { allowedPapers: string[] }) => d.allowedPapers.includes('K80')).map((d: { documentType: string }) => d.documentType).sort();
    expect(k80Types).toEqual(['CASHIER_SHIFT_RECEIPT', 'CASH_VOUCHER', 'INVOICE', 'WALLET_TOPUP_RECEIPT']);
  });

  it('chưa lưu gì → danh sách có đủ 13 chứng từ dùng bản DỰNG SẴN (id null, isBuiltin, mặc định), in được ngay', async () => {
    const items = await list(adminToken);
    expect(items).toHaveLength(13);
    expect(items.every((i) => i.id === null && i.isBuiltin && i.isDefault && i.version === null)).toBe(true);
    expect(ofType(items, 'PRESCRIPTION')[0]).toMatchObject({ paperSize: 'A4', name: 'Đơn thuốc A4' });
    expect(ofType(items, 'INVOICE')[0]!.paperSize).toBe('A5');
    expect(ofType(items, 'INVOICE')[0]!.config).toEqual(buildDefaultPrintTemplateConfig('A5'));
  });

  it('GET resolved: MỌI nhân viên đăng nhập đọc được (bác sĩ, lễ tân) → 13 mục; không token → 401', async () => {
    for (const token of [doctorToken, receptionistToken, adminToken]) {
      const items = await resolved(token);
      expect(items).toHaveLength(13);
      expect(items.find((i) => i.documentType === 'INVOICE')).toMatchObject({ paperSize: 'A5', widthMm: 148, heightMm: 210 });
    }
    expect((await request(app.getHttpServer()).get(`${API}/resolved`)).status).toBe(401);
  });

  it('GET resolved kèm "options": MỌI khổ giấy chứng từ in được (K80 chỉ chứng từ tiền), đúng 1 khổ isDefault, khổ chưa có bản mẫu kế thừa đầu trang/tiêu đề từ bản mặc định', async () => {
    const items = await resolved(adminToken);
    const invoice = items.find((i) => i.documentType === 'INVOICE')!;
    expect(invoice.options.map((o) => o.paperSize)).toEqual(['A4', 'A5', 'A5_LANDSCAPE', 'K80']);
    expect(invoice.options.filter((o) => o.isDefault).map((o) => o.paperSize)).toEqual(['A5']);
    expect(items.find((i) => i.documentType === 'PRESCRIPTION')!.options.map((o) => o.paperSize)).toEqual(['A4', 'A5', 'A5_LANDSCAPE']);
    const k80 = invoice.options.find((o) => o.paperSize === 'K80')!;
    expect(k80).toMatchObject({ widthMm: 80, heightMm: null });
    expect(k80.config.header.showLogo).toBe(false);
    expect(k80.config.footer.showSignature).toBe(false);
    expect(k80.config.margins.topMm).toBe(3);
  });

  it('thêm bản KHÁC khổ dựng sẵn: bản dựng sẵn được LƯU làm mặc định, bản mới không mặc định (không biến mất)', async () => {
    const res = await request(app.getHttpServer())
      .post(API)
      .set(authed(adminToken))
      .send({ documentType: 'PRESCRIPTION', name: 'Đơn thuốc A5 — kẹp sổ', paperSize: 'A5' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ documentType: 'PRESCRIPTION', paperSize: 'A5', isDefault: false, isBuiltin: false, version: 1 });

    const items = ofType(await list(adminToken), 'PRESCRIPTION');
    expect(items.map((i) => [i.paperSize, i.isDefault]).sort()).toEqual([
      ['A4', true],
      ['A5', false],
    ]);
    expect((await resolved(adminToken)).find((r) => r.documentType === 'PRESCRIPTION')!.paperSize).toBe('A4');
  });

  it('trùng khổ giấy cho cùng chứng từ → 409 PRINT_TEMPLATE_DUPLICATE_PAPER', async () => {
    const res = await request(app.getHttpServer()).post(API).set(authed(adminToken)).send({ documentType: 'PRESCRIPTION', name: 'Lại A5', paperSize: 'A5' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRINT_TEMPLATE_DUPLICATE_PAPER');
  });

  it('K80 chỉ cho chứng từ TIỀN: đơn thuốc/phiếu kho → 422 PRINT_TEMPLATE_PAPER_NOT_ALLOWED; phiếu thu → được', async () => {
    for (const documentType of ['PRESCRIPTION', 'STOCK_RECEIPT', 'MEDICAL_RECORD']) {
      const res = await request(app.getHttpServer()).post(API).set(authed(adminToken)).send({ documentType, name: 'K80', paperSize: 'K80' });
      expect(res.status, documentType).toBe(422);
      expect(res.body.error.code).toBe('PRINT_TEMPLATE_PAPER_NOT_ALLOWED');
    }
    const ok = await request(app.getHttpServer()).post(API).set(authed(adminToken)).send({ documentType: 'INVOICE', name: 'Phiếu thu K80', paperSize: 'K80' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.config).toEqual(buildDefaultPrintTemplateConfig('K80'));
    expect(ok.body.data.config.footer.showSignature).toBe(false);
    expect(ok.body.data.config.header.showLogo).toBe(false);
  });

  it('cấu hình sai (lề âm / >40 / 4 liên / tiêu đề quá dài) → 400', async () => {
    const base = buildDefaultPrintTemplateConfig('A4');
    const bad = [
      { ...base, margins: { ...base.margins, topMm: -1 } },
      { ...base, margins: { ...base.margins, leftMm: 41 } },
      { ...base, copies: { count: 4, labels: [] } },
      { ...base, title: { text: 'x'.repeat(61) } },
    ];
    for (const config of bad) {
      const res = await request(app.getHttpServer()).post(API).set(authed(adminToken)).send({ documentType: 'STOCK_ISSUE', name: 'Lỗi', paperSize: 'A4', config });
      expect(res.status).toBe(400);
    }
  });

  it('bác sĩ/lễ tân (không clinic_config.update) không tạo/sửa/xoá/thiết lập nhanh được → 403', async () => {
    const body = { documentType: 'STOCK_COUNT', name: 'X', paperSize: 'A4' };
    for (const token of [doctorToken, receptionistToken]) {
      expect((await request(app.getHttpServer()).post(API).set(authed(token)).send(body)).status).toBe(403);
      expect((await request(app.getHttpServer()).patch(`${API}/${randomUUID()}`).set(authed(token)).send({ version: 1 })).status).toBe(403);
      expect((await request(app.getHttpServer()).delete(`${API}/${randomUUID()}`).set(authed(token)).send({ version: 1 })).status).toBe(403);
      expect((await request(app.getHttpServer()).post(`${API}/quick-setup`).set(authed(token)).send({})).status).toBe(403);
    }
  });

  it('sửa tên + cấu hình (2 liên, ghi chú): lưu đúng, tăng version; version cũ → 409 CONCURRENT_MODIFICATION', async () => {
    const a5 = ofType(await list(adminToken), 'PRESCRIPTION').find((i) => i.paperSize === 'A5')!;
    const config = { ...a5.config, copies: { count: 2, labels: ['Liên 1 — Lưu', 'Liên 2 — Khách hàng'] }, footer: { ...a5.config.footer, note: 'Tái khám theo lịch hẹn.' } };
    const res = await request(app.getHttpServer()).patch(`${API}/${a5.id}`).set(authed(adminToken)).send({ name: 'Đơn thuốc A5 — sửa', config, version: a5.version });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Đơn thuốc A5 — sửa', version: 2 });
    expect(res.body.data.config.copies.count).toBe(2);
    expect(res.body.data.config.footer.note).toBe('Tái khám theo lịch hẹn.');

    const stale = await request(app.getHttpServer()).patch(`${API}/${a5.id}`).set(authed(adminToken)).send({ name: 'Cũ', version: a5.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');
  });

  it('2 yêu cầu sửa ĐỒNG THỜI cùng version → đúng 1 thành công, 1 bị 409 (không ghi trộn)', async () => {
    const a5 = ofType(await list(adminToken), 'PRESCRIPTION').find((i) => i.paperSize === 'A5')!;
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).patch(`${API}/${a5.id}`).set(authed(adminToken)).send({ name: 'Song song 1', version: a5.version }),
      request(app.getHttpServer()).patch(`${API}/${a5.id}`).set(authed(adminToken)).send({ name: 'Song song 2', version: a5.version }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });

  it('đặt bản A5 làm MẶC ĐỊNH: bản A4 tự bỏ cờ (luôn đúng 1 mặc định), resolved đổi sang A5', async () => {
    const a5 = ofType(await list(adminToken), 'PRESCRIPTION').find((i) => i.paperSize === 'A5')!;
    const res = await request(app.getHttpServer()).patch(`${API}/${a5.id}`).set(authed(adminToken)).send({ isDefault: true, version: a5.version });
    expect(res.status).toBe(200);
    const items = ofType(await list(adminToken), 'PRESCRIPTION');
    expect(items.filter((i) => i.isDefault).map((i) => i.paperSize)).toEqual(['A5']);
    expect((await resolved(doctorToken)).find((r) => r.documentType === 'PRESCRIPTION')!.paperSize).toBe('A5');
    // DB: partial unique index luôn đúng 1 mặc định
    const defaults = await privileged.printTemplate.count({ where: { tenantId: fixture.tenantA.id, documentType: 'PRESCRIPTION', isDefault: true, deletedAt: null } });
    expect(defaults).toBe(1);
  });

  it('xoá bản đang là mặc định khi còn bản khác → 409 PRINT_TEMPLATE_DEFAULT_CANNOT_DELETE; xoá bản không mặc định → được', async () => {
    const items = ofType(await list(adminToken), 'PRESCRIPTION');
    const def = items.find((i) => i.isDefault)!;
    const other = items.find((i) => !i.isDefault)!;
    const blocked = await request(app.getHttpServer()).delete(`${API}/${def.id}`).set(authed(adminToken)).send({ version: def.version });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PRINT_TEMPLATE_DEFAULT_CANNOT_DELETE');

    const ok = await request(app.getHttpServer()).delete(`${API}/${other.id}`).set(authed(adminToken)).send({ version: other.version });
    expect(ok.status).toBe(200);
    expect(ofType(await list(adminToken), 'PRESCRIPTION').map((i) => i.id)).toEqual([def.id]);

    // Xoá bản duy nhất (đang mặc định) → quay về bản dựng sẵn
    const last = ofType(await list(adminToken), 'PRESCRIPTION')[0]!;
    expect((await request(app.getHttpServer()).delete(`${API}/${last.id}`).set(authed(adminToken)).send({ version: last.version })).status).toBe(200);
    const back = ofType(await list(adminToken), 'PRESCRIPTION');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: null, isBuiltin: true, paperSize: 'A4' });
  });

  it('xoá với version cũ → 409; id không tồn tại → 404', async () => {
    const created = await request(app.getHttpServer()).post(API).set(authed(adminToken)).send({ documentType: 'STOCK_COUNT', name: 'Kiểm kê A5', paperSize: 'A5' });
    const row = created.body.data as PrintTemplate;
    expect((await request(app.getHttpServer()).delete(`${API}/${row.id}`).set(authed(adminToken)).send({ version: 99 })).status).toBe(409);
    expect((await request(app.getHttpServer()).delete(`${API}/${randomUUID()}`).set(authed(adminToken)).send({ version: 1 })).status).toBe(404);
  });

  it('"Thiết lập nhanh" MONEY_A5_REST_A4: chứng từ tiền → A5, còn lại A4 (Bệnh án luôn A4), ghi đè đầu trang, đặt mặc định; chạy lại không lỗi', async () => {
    const header = { showLogo: true, showClinicName: true, showAddress: false, showPhone: true, showTaxCode: true, showDivider: false };
    const body = { paperPreset: 'MONEY_A5_REST_A4', header, documentTypes: ['INVOICE', 'WALLET_TOPUP_RECEIPT', 'PRESCRIPTION', 'MEDICAL_RECORD', 'STOCK_RECEIPT'] };
    const res = await request(app.getHttpServer()).post(`${API}/quick-setup`).set(authed(adminToken)).send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.appliedCount).toBe(5);

    const r = await resolved(receptionistToken);
    const paper = (t: string) => r.find((x) => x.documentType === t)!.paperSize;
    expect(paper('INVOICE')).toBe('A5');
    expect(paper('WALLET_TOPUP_RECEIPT')).toBe('A5');
    expect(paper('PRESCRIPTION')).toBe('A4');
    expect(paper('MEDICAL_RECORD')).toBe('A4');
    expect(paper('STOCK_RECEIPT')).toBe('A4');
    expect(r.find((x) => x.documentType === 'INVOICE')!.config.header).toEqual(header);
    // Chứng từ KHÔNG chọn giữ nguyên
    expect(paper('CASH_VOUCHER')).toBe('A5');

    const again = await request(app.getHttpServer()).post(`${API}/quick-setup`).set(authed(adminToken)).send(body);
    expect(again.status).toBe(200);
    // Vẫn đúng 1 mặc định/chứng từ, không trùng khổ
    for (const documentType of ['INVOICE', 'PRESCRIPTION', 'MEDICAL_RECORD']) {
      const rows = await privileged.printTemplate.findMany({ where: { tenantId: fixture.tenantA.id, documentType: documentType as never, deletedAt: null } });
      expect(rows.filter((x) => x.isDefault)).toHaveLength(1);
      expect(new Set(rows.map((x) => x.paperSize)).size).toBe(rows.length);
    }
  });

  it('"Thiết lập nhanh" KEEP giữ khổ đang dùng (không đổi khổ), chỉ ghi đè đầu trang; ALL_A4 đưa phiếu thu về A4', async () => {
    const header = { showLogo: false, showClinicName: true, showAddress: true, showPhone: true, showTaxCode: false, showDivider: true };
    await request(app.getHttpServer()).post(`${API}/quick-setup`).set(authed(adminToken)).send({ paperPreset: 'KEEP', header, documentTypes: ['INVOICE'] });
    const keep = (await resolved(adminToken)).find((x) => x.documentType === 'INVOICE')!;
    expect(keep.paperSize).toBe('A5');
    expect(keep.config.header.showLogo).toBe(false);

    await request(app.getHttpServer()).post(`${API}/quick-setup`).set(authed(adminToken)).send({ paperPreset: 'ALL_A4', header, documentTypes: ['INVOICE'] });
    expect((await resolved(adminToken)).find((x) => x.documentType === 'INVOICE')!.paperSize).toBe('A4');
  });

  it('cấu hình lưu hỏng trong DB → rơi về mặc định theo khổ giấy (không làm vỡ in/danh sách)', async () => {
    const row = await privileged.printTemplate.create({
      data: {
        tenantId: fixture.tenantA.id,
        documentType: 'STOCK_TRANSFER',
        paperSize: 'A4',
        name: 'Hỏng',
        isDefault: true,
        configJson: { margins: 'sai' },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const items = ofType(await list(adminToken), 'STOCK_TRANSFER');
    expect(items[0]!.id).toBe(row.id);
    expect(items[0]!.config).toEqual(buildDefaultPrintTemplateConfig('A4'));
    expect((await resolved(doctorToken)).find((r) => r.documentType === 'STOCK_TRANSFER')!.config).toEqual(buildDefaultPrintTemplateConfig('A4'));
  });

  it('cách ly tenant: tenant B không thấy bản mẫu của A (vẫn dựng sẵn), không sửa/xoá được id của A → 404', async () => {
    const itemsB = await list(tenantBAdminToken);
    expect(itemsB.every((i) => i.isBuiltin)).toBe(true);
    const a = await privileged.printTemplate.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, deletedAt: null } });
    expect((await request(app.getHttpServer()).patch(`${API}/${a.id}`).set(authed(tenantBAdminToken)).send({ name: 'Xâm nhập', version: a.version })).status).toBe(404);
    expect((await request(app.getHttpServer()).delete(`${API}/${a.id}`).set(authed(tenantBAdminToken)).send({ version: a.version })).status).toBe(404);
    const rB = await resolved(tenantBAdminToken);
    expect(rB.find((r) => r.documentType === 'INVOICE')!.paperSize).toBe('A5');
  });

  it('ghi audit log cho tạo/sửa/xoá/thiết lập nhanh', async () => {
    const audit = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, entityType: 'print_template' } });
    const actions = new Set(audit.map((a) => a.action));
    for (const action of ['print_template.created', 'print_template.updated', 'print_template.deleted', 'print_template.quick_setup']) {
      expect(actions.has(action), action).toBe(true);
    }
  });
});
