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

/** HTTP e2e cho module `drug` (Sprint 4, S4-03) — danh mục thuốc THEO TENANT, "Trường hợp A" đã chốt (không kho, không giá bán). */
describe('HTTP e2e — /api/v1/drugs', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let doctorToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-drug-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createDrug(
    token: string,
    overrides: Partial<{
      code: string;
      name: string;
      itemType: 'MEDICINE' | 'SUPPLY';
      ingredients: unknown[];
      units: unknown[];
      defaultSellPrice: number;
      unitPricingEnabled: boolean;
      drugGroupCode: string;
      routeCode: string;
      manufacturer: string;
      controlType: string;
      isPrescriptionOnly: boolean;
      registrationNumber: string;
      dosageForm: string;
      countryOfOrigin: string;
    }> = {},
  ) {
    const itemType = overrides.itemType ?? 'MEDICINE';
    // Rà soát #151 đối chiếu tài liệu quy chuẩn kho thuốc/VTYT: Nhóm thuốc/Đường dùng/Hoạt chất bắt
    // buộc CHỈ khi MEDICINE (Vật tư y tế không có các khái niệm này, và không có hoạt chất — xem
    // test "Vật tư kèm hoạt chất → 400"). Giá bán/Hãng sản xuất bắt buộc cho CẢ 2 loại.
    const defaultIngredients = itemType === 'MEDICINE' ? [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }] : [];
    const res = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(token))
      .send({
        code: overrides.code ?? `DRG-${randomUUID().slice(0, 8)}`,
        name: overrides.name ?? 'Paracetamol 500mg',
        itemType,
        baseUnitCode: 'VIEN',
        activeIngredient: 'Paracetamol',
        unit: 'Viên',
        concentration: '500mg',
        manufacturerCode: overrides.manufacturer ?? 'TEST_MANUFACTURER',
        defaultSellPrice: overrides.defaultSellPrice ?? 10000,
        ...(itemType === 'MEDICINE'
          ? {
              drugGroupCode: overrides.drugGroupCode ?? 'TEST_GROUP',
              routeCode: overrides.routeCode ?? 'TEST_ROUTE',
              registrationNumber: overrides.registrationNumber ?? 'VD-TEST-0001',
              dosageForm: overrides.dosageForm ?? 'Viên nén',
              countryOfOrigin: overrides.countryOfOrigin ?? 'Việt Nam',
            }
          : {}),
        ingredients: overrides.ingredients ?? defaultIngredients,
        units: overrides.units ?? [],
        ...(overrides.unitPricingEnabled !== undefined ? { unitPricingEnabled: overrides.unitPricingEnabled } : {}),
        ...(overrides.controlType !== undefined ? { controlType: overrides.controlType } : {}),
        ...(overrides.isPrescriptionOnly !== undefined ? { isPrescriptionOnly: overrides.isPrescriptionOnly } : {}),
      });
    return res;
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

    fixture = await createTwoTenantFixture(privileged, 'Drug e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    clinicAdminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/drugs');
    expect(res.status).toBe(401);
  });

  it('clinic_admin tạo thuốc mới → 201/200, đủ trường', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Augmentin 1g' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Augmentin 1g');
    expect(res.body.data.activeIngredient).toBe('Paracetamol');
    expect(res.body.data.isActive).toBe(true);
    expect(res.body.data.version).toBe(1);
  });

  it('trùng mã thuốc trong cùng tenant → 409 DRUG_DUPLICATE_CODE', async () => {
    const code = `DRG-DUP-${randomUUID().slice(0, 8)}`;
    await createDrug(clinicAdminToken, { code });
    const res = await createDrug(clinicAdminToken, { code });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DRUG_DUPLICATE_CODE');
  });

  it('bác sĩ (drug.read) tìm thuốc theo tên không dấu/phân biệt hoa thường → khớp', async () => {
    await createDrug(clinicAdminToken, { name: 'Cefixim 200mg' });
    const res = await request(app.getHttpServer()).get('/api/v1/drugs').query({ q: 'cefixim' }).set(authed(doctorToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items.some((d: { name: string }) => d.name === 'Cefixim 200mg')).toBe(true);
  });

  it('receptionist (drug.read) xem được danh sách nhưng không tạo được thuốc (thiếu drug.manage) → 403', async () => {
    const listRes = await request(app.getHttpServer()).get('/api/v1/drugs').set(authed(receptionistToken));
    expect(listRes.status).toBe(200);

    const createRes = await createDrug(receptionistToken);
    expect(createRes.status).toBe(403);
  });

  it('clinic_admin ẩn thuốc (isActive=false) qua PATCH → mặc định không còn trong danh sách, includeInactive=true vẫn thấy', async () => {
    const created = await createDrug(clinicAdminToken, { name: 'Thuốc ẩn e2e' });
    const drugId = created.body.data.id as string;

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/drugs/${drugId}`)
      .set(authed(clinicAdminToken))
      .send({ isActive: false, version: 1 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.isActive).toBe(false);
    expect(patchRes.body.data.version).toBe(2);

    const defaultList = await request(app.getHttpServer()).get('/api/v1/drugs').set(authed(doctorToken));
    expect(defaultList.body.data.items.some((d: { id: string }) => d.id === drugId)).toBe(false);

    const includeInactiveList = await request(app.getHttpServer()).get('/api/v1/drugs').query({ includeInactive: 'true' }).set(authed(doctorToken));
    expect(includeInactiveList.body.data.items.some((d: { id: string }) => d.id === drugId)).toBe(true);
  });

  it('version cũ → 409 CONCURRENT_MODIFICATION', async () => {
    const created = await createDrug(clinicAdminToken);
    const drugId = created.body.data.id as string;
    await request(app.getHttpServer()).patch(`/api/v1/drugs/${drugId}`).set(authed(clinicAdminToken)).send({ name: 'Đổi tên lần 1', version: 1 });

    const res = await request(app.getHttpServer()).patch(`/api/v1/drugs/${drugId}`).set(authed(clinicAdminToken)).send({ name: 'Đổi tên lần 2', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
  });

  it('cách ly tenant — tenant B không thấy/sửa được thuốc tenant A (404)', async () => {
    const created = await createDrug(clinicAdminToken);
    const drugId = created.body.data.id as string;

    const listRes = await request(app.getHttpServer()).get('/api/v1/drugs').set(authed(tenantBAdminToken));
    expect(listRes.body.data.items.some((d: { id: string }) => d.id === drugId)).toBe(false);

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/drugs/${drugId}`)
      .set(authed(tenantBAdminToken))
      .send({ name: 'Sửa từ tenant khác', version: 1 });
    expect(patchRes.status).toBe(404);
  });

  // Kho Thuốc & Vật tư y tế GĐ1 (docs/DECISIONS.md #146).
  it('GĐ1 — tạo thuốc kèm hoạt chất + chuỗi quy đổi đơn vị, đọc lại đủ dữ liệu', async () => {
    const res = await createDrug(clinicAdminToken, {
      name: 'Panadol Extra GĐ1',
      ingredients: [
        { activeIngredientCode: 'PARA', strengthValue: 500000, strengthUnitCode: 'MG' },
        { activeIngredientCode: 'CAF', strengthValue: 65000, strengthUnitCode: 'MG' },
      ],
      units: [
        { unitCode: 'Vỉ', sortOrder: 0, factorToUnitBelow: 10 },
        { unitCode: 'Hộp', sortOrder: 1, factorToUnitBelow: 10 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.itemType).toBe('MEDICINE');
    expect(res.body.data.ingredients).toHaveLength(2);
    expect(res.body.data.units).toHaveLength(2);
    expect(res.body.data.units.map((u: { unitCode: string }) => u.unitCode)).toEqual(['Vỉ', 'Hộp']);
    expect(res.body.data.unitPricingEnabled).toBe(false);
  });

  it('Giá theo từng đơn vị — mặc định TẮT, không bắt buộc giá riêng từng bậc', async () => {
    const res = await createDrug(clinicAdminToken, {
      name: 'Amoxicillin GĐ1',
      defaultSellPrice: 2000,
      units: [{ unitCode: 'Vỉ', sortOrder: 0, factorToUnitBelow: 10 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.unitPricingEnabled).toBe(false);
    expect(res.body.data.units[0].sellPrice).toBeNull();
  });

  it('Giá theo từng đơn vị — bật nhưng thiếu giá đơn vị nhỏ nhất → 400', async () => {
    // Gửi thẳng request (không qua helper `createDrug()`) vì cố ý OMIT `defaultSellPrice` — helper
    // luôn điền mặc định 10000 kể từ khi trường này trở thành bắt buộc (rà soát #151).
    const res = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(clinicAdminToken))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name: 'Cefixim GĐ1',
        itemType: 'MEDICINE',
        baseUnitCode: 'VIEN',
        manufacturer: 'Test Manufacturer',
        drugGroupCode: 'TEST_GROUP',
        routeCode: 'TEST_ROUTE',
        ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }],
        unitPricingEnabled: true,
        units: [{ unitCode: 'Vỉ', sortOrder: 0, factorToUnitBelow: 10, sellPrice: 9000 }],
      });
    expect(res.status).toBe(400);
  });

  it('Giá theo từng đơn vị — bật nhưng thiếu giá 1 bậc quy đổi → 400', async () => {
    const res = await createDrug(clinicAdminToken, {
      name: 'Cefixim GĐ1b',
      unitPricingEnabled: true,
      defaultSellPrice: 500,
      units: [
        { unitCode: 'Vỉ', sortOrder: 0, factorToUnitBelow: 10, sellPrice: 9000 },
        { unitCode: 'Hộp', sortOrder: 1, factorToUnitBelow: 10 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('Giá theo từng đơn vị — bật + đủ giá mọi bậc → 200, đọc lại đúng giá riêng từng đơn vị', async () => {
    const res = await createDrug(clinicAdminToken, {
      name: 'Cefixim GĐ1c',
      unitPricingEnabled: true,
      defaultSellPrice: 500,
      units: [
        { unitCode: 'Vỉ', sortOrder: 0, factorToUnitBelow: 10, sellPrice: 9000 },
        { unitCode: 'Hộp', sortOrder: 1, factorToUnitBelow: 10, sellPrice: 85000 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.unitPricingEnabled).toBe(true);
    expect(res.body.data.defaultSellPrice).toBe(500);
    const byUnit = Object.fromEntries(res.body.data.units.map((u: { unitCode: string; sellPrice: number }) => [u.unitCode, u.sellPrice]));
    expect(byUnit['Vỉ']).toBe(9000);
    expect(byUnit['Hộp']).toBe(85000);
  });

  it('GĐ1 — sửa thuốc thay TOÀN BỘ hoạt chất (bulk-replace, không cộng dồn)', async () => {
    const created = await createDrug(clinicAdminToken, {
      ingredients: [{ activeIngredientCode: 'PARA', strengthValue: 500000, strengthUnitCode: 'MG' }],
    });
    const drugId = created.body.data.id as string;

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/drugs/${drugId}`)
      .set(authed(clinicAdminToken))
      .send({ version: 1, ingredients: [{ activeIngredientCode: 'IBU', strengthValue: 400000, strengthUnitCode: 'MG' }] });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.ingredients).toHaveLength(1);
    expect(patchRes.body.data.ingredients[0].activeIngredientCode).toBe('IBU');
  });

  it('GĐ1 — Vật tư y tế kèm hoạt chất → 400 (vật tư không có hoạt chất/hàm lượng)', async () => {
    const res = await createDrug(clinicAdminToken, {
      itemType: 'SUPPLY',
      ingredients: [{ activeIngredientCode: 'PARA', strengthValue: 500000, strengthUnitCode: 'MG' }],
    });
    expect(res.status).toBe(400);
  });

  it('GĐ1 — lọc theo itemType=SUPPLY chỉ trả vật tư, không lẫn thuốc', async () => {
    await createDrug(clinicAdminToken, { name: 'Bơm tiêm GĐ1', itemType: 'SUPPLY' });
    await createDrug(clinicAdminToken, { name: 'Amlodipin GĐ1', itemType: 'MEDICINE' });
    const res = await request(app.getHttpServer()).get('/api/v1/drugs').query({ itemType: 'SUPPLY' }).set(authed(doctorToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items.every((d: { itemType: string }) => d.itemType === 'SUPPLY')).toBe(true);
    expect(res.body.data.items.some((d: { name: string }) => d.name === 'Bơm tiêm GĐ1')).toBe(true);
  });

  // Rà soát #151 đối chiếu tài liệu quy chuẩn kho thuốc/VTYT — bổ sung bắt buộc Nhóm thuốc/Đường
  // dùng/Hoạt chất (chỉ Thuốc) và Giá bán/Hãng sản xuất (cả 2 loại), cùng 2 trường mới Rx/OTC +
  // phân loại kiểm soát đặc biệt (docs/DECISIONS.md #151).
  it('#151 — Thuốc thiếu Nhóm thuốc → 400', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Thiếu nhóm thuốc', drugGroupCode: '' });
    expect(res.status).toBe(400);
  });

  it('#151 — Thuốc thiếu Đường dùng → 400', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Thiếu đường dùng', routeCode: '' });
    expect(res.status).toBe(400);
  });

  it('#151 — Thuốc thiếu Hoạt chất & hàm lượng (rỗng) → 400', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Thiếu hoạt chất', ingredients: [] });
    expect(res.status).toBe(400);
  });

  it('#151 — Vật tư y tế KHÔNG bắt buộc Nhóm thuốc/Đường dùng/Hoạt chất (chỉ Thuốc mới bắt buộc)', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Vật tư OK GĐ1', itemType: 'SUPPLY' });
    expect(res.status).toBe(200);
  });

  it('#151 — thiếu Hãng sản xuất → 400 (bắt buộc cho cả Thuốc lẫn Vật tư y tế)', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Thiếu hãng SX', manufacturer: '' });
    expect(res.status).toBe(400);
  });

  it('#151 — thiếu Giá bán mặc định → 400 (bắt buộc cho cả Thuốc lẫn Vật tư y tế)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(clinicAdminToken))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name: 'Thiếu giá bán',
        itemType: 'SUPPLY',
        baseUnitCode: 'VIEN',
        manufacturer: 'Test Manufacturer',
        ingredients: [],
        units: [],
      });
    expect(res.status).toBe(400);
  });

  it('#151 — không truyền controlType/isPrescriptionOnly → mặc định NORMAL/true', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Mặc định Rx/kiểm soát' });
    expect(res.status).toBe(200);
    expect(res.body.data.controlType).toBe('NORMAL');
    expect(res.body.data.isPrescriptionOnly).toBe(true);
  });

  it('#151 — tạo thuốc kiểm soát đặc biệt + OTC tường minh → 200, đọc lại đúng; PATCH đổi lại → version tăng', async () => {
    const created = await createDrug(clinicAdminToken, {
      name: 'Morphin GĐ1',
      controlType: 'NARCOTIC',
      isPrescriptionOnly: false,
    });
    expect(created.status).toBe(200);
    expect(created.body.data.controlType).toBe('NARCOTIC');
    expect(created.body.data.isPrescriptionOnly).toBe(false);

    const drugId = created.body.data.id as string;
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/drugs/${drugId}`)
      .set(authed(clinicAdminToken))
      .send({ version: 1, controlType: 'PSYCHOTROPIC', isPrescriptionOnly: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.version).toBe(2);
    expect(patchRes.body.data.controlType).toBe('PSYCHOTROPIC');
    expect(patchRes.body.data.isPrescriptionOnly).toBe(true);
  });

  // Mở rộng #151 (chủ dự án rà soát chi tiết tài liệu, xác nhận thêm từng trường qua nhiều lượt) —
  // registrationNumber/dosageForm/countryOfOrigin bắt buộc CHỈ khi MEDICINE; defaultDosage/
  // usageInstruction/contraindications/storageConditions/barcode tùy chọn. Tất cả CHỈ có ý nghĩa với
  // MEDICINE — Vật tư y tế (VTYT) giữ nguyên hoãn, không có field nào trong nhóm này.
  it('#151 — Thuốc thiếu Số đăng ký lưu hành → 400', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Thiếu SĐK', registrationNumber: '' });
    expect(res.status).toBe(400);
  });

  it('#151 — Thuốc thiếu Dạng bào chế → 400', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Thiếu dạng bào chế', dosageForm: '' });
    expect(res.status).toBe(400);
  });

  it('#151 — Thuốc thiếu Nước sản xuất → 400', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Thiếu nước SX', countryOfOrigin: '' });
    expect(res.status).toBe(400);
  });

  it('#151 — Vật tư y tế KHÔNG bắt buộc SĐK/Dạng bào chế/Nước sản xuất', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Vật tư OK GĐ1b', itemType: 'SUPPLY' });
    expect(res.status).toBe(200);
  });

  it('#151 — tạo đủ SĐK/Dạng bào chế/Nước sản xuất + 4 trường tùy chọn → 200, đọc lại đúng; PATCH sửa lại → version tăng', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/drugs')
      .set(authed(clinicAdminToken))
      .send({
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name: 'Paracetamol đầy đủ GĐ1',
        itemType: 'MEDICINE',
        baseUnitCode: 'VIEN',
        manufacturerCode: 'MFR_DUOC_HAU_GIANG',
        defaultSellPrice: 2000,
        drugGroupCode: 'TEST_GROUP',
        routeCode: 'TEST_ROUTE',
        registrationNumber: 'VD-25432-16',
        dosageForm: 'VIEN_NEN_BAO_PHIM',
        countryOfOrigin: 'VIET_NAM',
        defaultDosage: 'Uống 1 viên/lần x 2 lần/ngày',
        usageInstruction: 'Uống sau khi ăn no',
        contraindications: 'Không dùng cho người suy gan nặng',
        storageConditions: 'BAO_QUAN_KHO_RAO',
        storageLocation: 'KE_A1',
        barcode: '8938501234567',
        ingredients: [{ activeIngredientCode: 'TEST_INGREDIENT', strengthValue: 500000, strengthUnitCode: 'MG' }],
        units: [],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.registrationNumber).toBe('VD-25432-16');
    expect(res.body.data.dosageForm).toBe('VIEN_NEN_BAO_PHIM');
    expect(res.body.data.countryOfOrigin).toBe('VIET_NAM');
    expect(res.body.data.defaultDosage).toBe('Uống 1 viên/lần x 2 lần/ngày');
    expect(res.body.data.usageInstruction).toBe('Uống sau khi ăn no');
    expect(res.body.data.contraindications).toBe('Không dùng cho người suy gan nặng');
    expect(res.body.data.storageConditions).toBe('BAO_QUAN_KHO_RAO');
    expect(res.body.data.storageLocation).toBe('KE_A1');
    expect(res.body.data.barcode).toBe('8938501234567');

    const drugId = res.body.data.id as string;
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/drugs/${drugId}`)
      .set(authed(clinicAdminToken))
      .send({ version: 1, barcode: '8938501234568', storageConditions: null });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.version).toBe(2);
    expect(patchRes.body.data.barcode).toBe('8938501234568');
    expect(patchRes.body.data.storageConditions).toBeNull();
  });

  it('#151 — không truyền 5 trường tùy chọn mới → mặc định null, không lỗi', async () => {
    const res = await createDrug(clinicAdminToken, { name: 'Không có trường tuỳ chọn GĐ1' });
    expect(res.status).toBe(200);
    expect(res.body.data.defaultDosage).toBeNull();
    expect(res.body.data.usageInstruction).toBeNull();
    expect(res.body.data.contraindications).toBeNull();
    expect(res.body.data.storageConditions).toBeNull();
    expect(res.body.data.barcode).toBeNull();
  });
});
