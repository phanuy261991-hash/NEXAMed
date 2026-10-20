import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrescriptionFacilityCodeMissingError } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { BusinessCodeService } from './business-code.service';

/**
 * HTTP e2e cho mã đơn thuốc chuẩn Bộ Y tế, GIAI ĐOẠN 1 (docs/DECISIONS.md #242): mã cơ sở KCB theo chi nhánh, kiểm tra "sẵn sàng", bật/tắt chế độ
 * "Chuẩn Bộ Y tế" ở "Cấu hình mẫu mã phát sinh", bộ đếm chung 4 loại đơn theo mã cơ sở (không đánh số lại, duy nhất khi chạy đồng thời), cô lập hai công ty.
 */
describe('HTTP e2e — mã đơn thuốc chuẩn Bộ Y tế (giai đoạn 1)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  let uow: UnitOfWorkService;
  let codes: BusinessCodeService;
  const password = 'Test@12345';

  let branchA1: string;
  let branchB1: string;
  let branchA2: string;
  let adminA: string;
  let adminB: string;
  let receptionistA: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-pnc-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  async function patchBranch(token: string, id: string, body: Record<string, unknown>) {
    const current = await http().get('/api/v1/branches?includeInactive=true').set(authed(token));
    const branch = (current.body.data.items as { id: string; version: number }[]).find((b) => b.id === id);
    return http().patch(`/api/v1/branches/${id}`).set(authed(token)).send({ ...body, version: branch?.version ?? 1 });
  }

  function readiness(token: string) {
    return http().get('/api/v1/clinic-settings/code-templates/prescription-standard-readiness').set(authed(token));
  }

  function patchPrescription(token: string, body: Record<string, unknown>) {
    return http().patch('/api/v1/clinic-settings/code-templates/PRESCRIPTION').set(authed(token)).send(body);
  }

  const CUSTOM_BODY = { template: 'DT[Năm 2 số][Tháng][Số đếm]', counterDigits: 6 };

  async function nationalCode(tenantId: string, branchId: string, kind: 'C' | 'N' | 'H' | 'Y') {
    // Giống luồng ký đơn thật: tra mã cơ sở TRƯỚC, rồi mới mở transaction cấp số (không lồng 2 kết nối).
    const facilityCode = await codes.resolveFacilityCodeForBranch(tenantId, branchId);
    return uow.runInTenantScope(tenantId, (tx) => codes.generatePrescriptionNationalCode(tx, tenantId, SYSTEM_TEST_ACTOR, facilityCode, kind));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    uow = app.get(UnitOfWorkService);
    codes = app.get(BusinessCodeService);

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();

    fixture = await createTwoTenantFixture(privileged, 'PrescriptionNationalCode e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA1 = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchB1 = await getDefaultBranchId(privileged, fixture.tenantB.id);

    adminA = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    receptionistA = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    adminB = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('mặc định chế độ CUSTOM, chưa bật; loại mã khác không hỗ trợ chế độ chuẩn', async () => {
    const res = await http().get('/api/v1/clinic-settings/code-templates').set(authed(adminA));
    expect(res.status).toBe(200);
    const items = res.body.data.items as { codeType: string; mode: string; supportsStandardMode: boolean }[];
    expect(items.find((i) => i.codeType === 'PRESCRIPTION')).toMatchObject({ mode: 'CUSTOM', supportsStandardMode: true });
    expect(items.filter((i) => i.codeType !== 'PRESCRIPTION').every((i) => i.mode === 'CUSTOM' && !i.supportsStandardMode)).toBe(true);
  });

  it('kiểm tra sẵn sàng: chưa có mã KCB ở đâu cả → ready=false; chỉ vai trò có clinic_config.read xem được', async () => {
    const res = await readiness(adminA);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ready: false, companyFacilityCode: null, multiBranch: false });
    expect(res.body.data.branches).toHaveLength(1);
    expect(res.body.data.branches[0]).toMatchObject({ branchId: branchA1, source: 'NONE', ready: false, exampleNextCode: null });

    expect((await readiness(receptionistA)).status).toBe(403);
    expect((await http().get('/api/v1/clinic-settings/code-templates/prescription-standard-readiness')).status).toBe(401);
  });

  it('không bật được chế độ chuẩn khi chưa có mã KCB → 422 PRESCRIPTION_STANDARD_MODE_NOT_READY, nêu tên chi nhánh thiếu', async () => {
    const res = await patchPrescription(adminA, { ...CUSTOM_BODY, mode: 'STANDARD' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRESCRIPTION_STANDARD_MODE_NOT_READY');
    const list = await http().get('/api/v1/clinic-settings/code-templates').set(authed(adminA));
    expect(list.body.data.items.find((i: { codeType: string }) => i.codeType === 'PRESCRIPTION').mode).toBe('CUSTOM');
  });

  it('mã cơ sở KCB của chi nhánh phải đúng 5 chữ số → 400; để trống (null) xoá mã', async () => {
    for (const bad of ['1234', '123456', 'abcde', '12 45']) {
      const res = await patchBranch(adminA, branchA1, { facilityCode: bad });
      expect(res.status, bad).toBe(400);
    }
    const ok = await patchBranch(adminA, branchA1, { facilityCode: '79001' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.facilityCode).toBe('79001');
    const cleared = await patchBranch(adminA, branchA1, { facilityCode: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.facilityCode).toBeNull();
    const again = await patchBranch(adminA, branchA1, { facilityCode: '79001' });
    expect(again.body.data.facilityCode).toBe('79001');
  });

  it('có mã KCB → sẵn sàng, bật chế độ chuẩn → khuôn chuẩn khoá, 7 chữ số, mã kế tiếp đúng 14 ký tự', async () => {
    const ready = await readiness(adminA);
    expect(ready.body.data.ready).toBe(true);
    expect(ready.body.data.branches[0]).toMatchObject({ source: 'BRANCH', effectiveFacilityCode: '79001', exampleNextCode: '790010000001-C' });

    const res = await patchPrescription(adminA, { ...CUSTOM_BODY, mode: 'STANDARD' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      mode: 'STANDARD',
      template: '[Mã cơ sở KCB][Số đếm]-[Loại đơn]',
      counterDigits: 7,
      locked: true,
      exampleNextCode: '790010000001-C',
    });
    expect(res.body.data.exampleNextCode).toHaveLength(14);

    // Không gửi `mode` thì giữ chế độ chuẩn hiện tại (PATCH không âm thầm tắt chế độ).
    const keep = await patchPrescription(adminA, CUSTOM_BODY);
    expect(keep.status).toBe(200);
    expect(keep.body.data.mode).toBe('STANDARD');
  });

  it('chế độ chuẩn chỉ cho mã đơn thuốc: loại mã khác → 400; token riêng của mã đơn thuốc ở loại mã khác → 400', async () => {
    const other = await http()
      .patch('/api/v1/clinic-settings/code-templates/PATIENT')
      .set(authed(adminA))
      .send({ template: 'BN[Số đếm]', counterDigits: 6, mode: 'STANDARD' });
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe('BUSINESS_CODE_MODE_UNSUPPORTED');

    const token = await http()
      .patch('/api/v1/clinic-settings/code-templates/PATIENT')
      .set(authed(adminA))
      .send({ template: 'BN[Mã cơ sở KCB][Số đếm]', counterDigits: 6 });
    expect(token.status).toBe(400);
    expect(token.body.error.code).toBe('BUSINESS_CODE_TEMPLATE_INVALID');
  });

  it('sinh mã: đúng định dạng xxxxxyyyyyyy-z, tăng dần từ 1, chung bộ đếm cho cả 4 loại đơn, không đánh số lại', async () => {
    const seen: string[] = [];
    for (const kind of ['C', 'N', 'H', 'Y', 'C'] as const) {
      seen.push(await nationalCode(fixture.tenantA.id, branchA1, kind));
    }
    expect(seen).toEqual(['790010000001-C', '790010000002-N', '790010000003-H', '790010000004-Y', '790010000005-C']);
    for (const code of seen) expect(code).toMatch(/^\d{5}\d{7}-[CNHY]$/);

    // Mã kế tiếp minh hoạ ở màn cấu hình phản ánh bộ đếm thật.
    const ready = await readiness(adminA);
    expect(ready.body.data.branches[0].exampleNextCode).toBe('790010000006-C');
  });

  it('chạy đồng thời 20 lần → 20 mã khác nhau, liên tục không hụt số', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => nationalCode(fixture.tenantA.id, branchA1, i % 2 === 0 ? 'C' : 'N')));
    const numbers = results.map((c) => Number(c.slice(5, 12))).sort((a, b) => a - b);
    expect(new Set(results).size).toBe(20);
    expect(numbers[0]).toBe(6);
    expect(numbers[19]).toBe(25);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 6));
  });

  it('chi nhánh thứ 2: mã riêng → bộ đếm riêng; chưa có mã riêng → dùng mã công ty, chung bộ đếm với chi nhánh cùng mã', async () => {
    await privileged.tenant.update({ where: { id: fixture.tenantA.id }, data: { facilityCode: '79001' } });
    const created = await http().post('/api/v1/branches').set(authed(adminA)).send({ name: 'Chi nhánh Hà Đông', facilityCode: '79002' });
    expect(created.status).toBe(200);
    expect(created.body.data.facilityCode).toBe('79002');
    branchA2 = created.body.data.id as string;

    const ready = await readiness(adminA);
    expect(ready.body.data).toMatchObject({ multiBranch: true, companyFacilityCode: '79001', ready: true });
    const b1 = ready.body.data.branches.find((b: { branchId: string }) => b.branchId === branchA1);
    const b2 = ready.body.data.branches.find((b: { branchId: string }) => b.branchId === branchA2);
    expect(b2).toMatchObject({ source: 'BRANCH', effectiveFacilityCode: '79002', exampleNextCode: '790020000001-C' });
    expect(b1.effectiveFacilityCode).toBe('79001');

    expect(await nationalCode(fixture.tenantA.id, branchA2, 'C')).toBe('790020000001-C');
    expect(await nationalCode(fixture.tenantA.id, branchA2, 'N')).toBe('790020000002-N');

    // Xoá mã riêng của chi nhánh 1: quay về mã công ty (cũng 79001) — cùng mã nên TIẾP TỤC bộ đếm cũ, không trùng.
    await patchBranch(adminA, branchA1, { facilityCode: null });
    const next = await nationalCode(fixture.tenantA.id, branchA1, 'C');
    expect(next).toBe('790010000026-C');
    const after = await readiness(adminA);
    expect(after.body.data.branches.find((b: { branchId: string }) => b.branchId === branchA1)).toMatchObject({ source: 'COMPANY', effectiveFacilityCode: '79001' });
  });

  it('mã công ty sai định dạng không được dùng làm mã dự phòng; chi nhánh không có mã hợp lệ → PRESCRIPTION_FACILITY_CODE_MISSING', async () => {
    await privileged.tenant.update({ where: { id: fixture.tenantA.id }, data: { facilityCode: 'KCB-12' } });
    await patchBranch(adminA, branchA1, { facilityCode: null });
    await expect(nationalCode(fixture.tenantA.id, branchA1, 'C')).rejects.toBeInstanceOf(PrescriptionFacilityCodeMissingError);
    const ready = await readiness(adminA);
    expect(ready.body.data.ready).toBe(false);
    expect(ready.body.data.companyFacilityCode).toBe('KCB-12');
    expect(ready.body.data.branches.find((b: { branchId: string }) => b.branchId === branchA1)).toMatchObject({ source: 'NONE', ready: false });
    await privileged.tenant.update({ where: { id: fixture.tenantA.id }, data: { facilityCode: '79001' } });
  });

  it('tắt chế độ chuẩn (có khuôn tuỳ chỉnh) → quay về CUSTOM; bộ đếm mã chuẩn giữ nguyên khi bật lại', async () => {
    const off = await patchPrescription(adminA, { ...CUSTOM_BODY, mode: 'CUSTOM' });
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ mode: 'CUSTOM', template: 'DT[Năm 2 số][Tháng][Số đếm]', counterDigits: 6 });

    const on = await patchPrescription(adminA, { ...CUSTOM_BODY, mode: 'STANDARD' });
    expect(on.status).toBe(200);
    expect(await nationalCode(fixture.tenantA.id, branchA1, 'C')).toBe('790010000027-C');
  });

  it('cô lập công ty: công ty B không thấy chi nhánh/mã của A, bộ đếm riêng dù trùng mã KCB 79001', async () => {
    const before = await readiness(adminB);
    expect(before.status).toBe(200);
    expect(before.body.data.branches).toHaveLength(1);
    expect(before.body.data.branches[0].branchId).toBe(branchB1);
    expect(before.body.data.branches.some((b: { branchId: string }) => [branchA1, branchA2].includes(b.branchId))).toBe(false);
    expect(before.body.data.ready).toBe(false);

    const notReady = await patchPrescription(adminB, { ...CUSTOM_BODY, mode: 'STANDARD' });
    expect(notReady.status).toBe(422);

    // Chi nhánh của công ty A không sửa được từ B (404), đọc readiness B không đổi.
    const cross = await http().patch(`/api/v1/branches/${branchA1}`).set(authed(adminB)).send({ facilityCode: '11111', version: 1 });
    expect(cross.status).toBe(404);

    const set = await patchBranch(adminB, branchB1, { facilityCode: '79001' });
    expect(set.status).toBe(200);
    expect(await nationalCode(fixture.tenantB.id, branchB1, 'C')).toBe('790010000001-C');

    // Công ty A không bị ảnh hưởng (vẫn ở số 27 → kế tiếp 28).
    const a = await readiness(adminA);
    expect(a.body.data.branches.find((b: { branchId: string }) => b.branchId === branchA1).exampleNextCode).toBe('790010000028-C');
  });
});
