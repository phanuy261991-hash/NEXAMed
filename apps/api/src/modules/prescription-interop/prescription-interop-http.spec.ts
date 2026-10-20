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
import { decryptPii } from '../../infrastructure/crypto/pii-encryption';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — Liên thông đơn thuốc quốc gia, cấu hình (docs/DECISIONS.md #242 GĐ3, mockup 8d): công tắc tổng + địa chỉ cổng (chung công ty), mã/mật khẩu cơ sở (THEO chi nhánh)
 * và bác sĩ (chung công ty, nhưng chỉ nhập hộ cho bác sĩ của chi nhánh đang làm). Mật khẩu mã hoá, KHÔNG bao giờ trả về, không vào nhật ký.
 * Hai chi nhánh cùng công ty A + công ty B để kiểm cô lập.
 */
describe('HTTP e2e — Liên thông đơn thuốc: cấu hình, mã + mật khẩu cơ sở/bác sĩ (#242 GĐ3)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchA: string;
  let branchB: string;
  let branchOfTenantB: string;
  let adminAToken: string;
  let doctorAToken: string;
  let receptionistToken: string;
  let adminBToken: string;
  let doctorAId: string;
  let doctorBranchBId: string;
  let doctorTenantBId: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(tenantId: string, roleName: string, label: string, branchId?: string) {
    const username = `e2e-interop-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${label}`, licenseNo: `CCHN-${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    if (branchId) await privileged.userBranch.create({ data: { tenantId, userId: user.id, branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return { id: user.id as string, username };
  }

  async function login(tenantId: string, username: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }

  const saveFacility = (token: string, branchId: string, body: Record<string, unknown>) => http().put(`/api/v1/prescription-interop/facilities/${branchId}/credential`).set(authed(token)).send(body);
  const saveDoctor = (token: string, userId: string, body: Record<string, unknown>) => http().put(`/api/v1/prescription-interop/doctors/${userId}/credential`).set(authed(token)).send(body);

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

    fixture = await createTwoTenantFixture(privileged, 'PrescriptionInterop e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    branchOfTenantB = await getDefaultBranchId(privileged, fixture.tenantB.id);

    // adminA/receptionist không có dòng gán → chi nhánh mặc định A. Chi nhánh B tạo qua HTTP (như thật).
    const adminA = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminA');
    adminAToken = await login(fixture.tenantA.id, adminA.username);
    const created = await http().post('/api/v1/branches').set(authed(adminAToken)).send({ name: 'Chi nhánh Quận 7', address: '88 Nguyễn Thị Thập', phone: '0283777556' });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    branchB = created.body.data.id;

    const doctorA = await createUser(fixture.tenantA.id, 'doctor', 'doctorA', branchA);
    doctorAId = doctorA.id;
    doctorAToken = await login(fixture.tenantA.id, doctorA.username);
    doctorBranchBId = (await createUser(fixture.tenantA.id, 'doctor', 'doctorB', branchB)).id;
    receptionistToken = await login(fixture.tenantA.id, (await createUser(fixture.tenantA.id, 'receptionist', 'recep')).username);

    const adminB = await createUser(fixture.tenantB.id, 'clinic_admin', 'adminTenantB');
    adminBToken = await login(fixture.tenantB.id, adminB.username);
    doctorTenantBId = (await createUser(fixture.tenantB.id, 'doctor', 'doctorTenantB')).id;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('công tắc tổng + địa chỉ cổng (chung cả công ty)', () => {
    it('mặc định TẮT, địa chỉ theo QĐ 808; bác sĩ đọc được công tắc (tự-phục vụ) nhưng không đọc/sửa cấu hình', async () => {
      const settings = await http().get('/api/v1/prescription-interop/settings').set(authed(adminAToken));
      expect(settings.status, JSON.stringify(settings.body)).toBe(200);
      expect(settings.body.data).toEqual({ enabled: false, sendEnabled: false, gatewayUrl: 'https://api.donthuocquocgia.vn', timeoutSeconds: 30, maxRetries: 5, appKeyConfigured: false });
      const status = await http().get('/api/v1/prescription-interop/status').set(authed(doctorAToken));
      expect(status.status).toBe(200);
      expect(status.body.data).toEqual({ enabled: false });
      expect((await http().get('/api/v1/prescription-interop/settings').set(authed(doctorAToken))).status).toBe(403);
      expect((await http().patch('/api/v1/prescription-interop/settings').set(authed(doctorAToken)).send({ enabled: true })).status).toBe(403);
      expect((await http().get('/api/v1/prescription-interop/status')).status).toBe(401);
    });

    it('sửa: bật công tắc, đổi địa chỉ (bỏ dấu / cuối), ghi nhật ký trước/sau; địa chỉ http (không phải máy cục bộ) bị từ chối', async () => {
      const bad = await http().patch('/api/v1/prescription-interop/settings').set(authed(adminAToken)).send({ gatewayUrl: 'http://cong.example.com' });
      expect(bad.status).toBe(400);
      expect((await http().patch('/api/v1/prescription-interop/settings').set(authed(adminAToken)).send({})).status).toBe(400);
      expect((await http().patch('/api/v1/prescription-interop/settings').set(authed(adminAToken)).send({ timeoutSeconds: 1 })).status).toBe(400);

      const ok = await http().patch('/api/v1/prescription-interop/settings').set(authed(adminAToken)).send({ enabled: true, gatewayUrl: 'https://thu.donthuocquocgia.vn/', maxRetries: 3 });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data).toEqual({ enabled: true, sendEnabled: false, gatewayUrl: 'https://thu.donthuocquocgia.vn', timeoutSeconds: 30, maxRetries: 3, appKeyConfigured: false });
      expect((await http().get('/api/v1/prescription-interop/status').set(authed(doctorAToken))).body.data).toEqual({ enabled: true });

      const audit = await privileged.auditLog.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, action: 'prescription_interop.settings_updated' }, orderBy: { occurredAt: 'desc' } });
      expect((audit.beforeJson as { enabled: boolean }).enabled).toBe(false);
      expect((audit.afterJson as { enabled: boolean }).enabled).toBe(true);
    });

    it('công ty B không bị ảnh hưởng (vẫn tắt, địa chỉ mặc định)', async () => {
      const res = await http().get('/api/v1/prescription-interop/settings').set(authed(adminBToken));
      expect(res.body.data).toEqual({ enabled: false, sendEnabled: false, gatewayUrl: 'https://api.donthuocquocgia.vn', timeoutSeconds: 30, maxRetries: 5, appKeyConfigured: false });
    });
  });

  describe('mã + mật khẩu của CƠ SỞ (theo chi nhánh)', () => {
    it('liệt kê đủ chi nhánh của công ty, chưa nhập gì; lễ tân không xem/sửa được', async () => {
      const res = await http().get('/api/v1/prescription-interop/facilities').set(authed(adminAToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as { branchId: string; code: string | null; hasPassword: boolean }[];
      expect(items.map((i) => i.branchId).sort()).toEqual([branchA, branchB].sort());
      expect(items.every((i) => i.code === null && !i.hasPassword)).toBe(true);
      expect((await http().get('/api/v1/prescription-interop/facilities').set(authed(receptionistToken))).status).toBe(403);
      expect((await saveFacility(receptionistToken, branchA, { code: 'CS-1', password: 'x' })).status).toBe(403);
    });

    it('lần đầu bắt buộc mật khẩu (422); lưu xong: trả hasPassword, KHÔNG trả mật khẩu, DB chỉ có bản mã hoá giải mã lại đúng', async () => {
      const noPassword = await saveFacility(adminAToken, branchA, { code: 'CS-790010421' });
      expect(noPassword.status).toBe(422);
      expect(noPassword.body.error.code).toBe('INTEROP_PASSWORD_REQUIRED');

      const saved = await saveFacility(adminAToken, branchA, { code: 'CS-790010421', password: 'matkhau-co-so-A' });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const row = (saved.body.data.items as { branchId: string; code: string | null; hasPassword: boolean }[]).find((i) => i.branchId === branchA)!;
      expect(row).toMatchObject({ code: 'CS-790010421', hasPassword: true });
      expect(JSON.stringify(saved.body)).not.toContain('matkhau-co-so-A');

      const stored = await privileged.interopFacilityCredential.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null } });
      expect(Buffer.from(stored.passwordEnc).toString('utf8')).not.toContain('matkhau');
      expect(decryptPii(Buffer.from(stored.passwordEnc), process.env.ENCRYPTION_KEY!)).toBe('matkhau-co-so-A');
    });

    it('sửa chỉ mã (bỏ trống mật khẩu) → giữ nguyên mật khẩu; có mật khẩu mới → ghi đè; nhật ký không chứa mật khẩu', async () => {
      const before = await privileged.interopFacilityCredential.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null } });
      expect((await saveFacility(adminAToken, branchA, { code: 'CS-790010999' })).status).toBe(200);
      const kept = await privileged.interopFacilityCredential.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null } });
      expect(kept.code).toBe('CS-790010999');
      expect(Buffer.from(kept.passwordEnc).equals(Buffer.from(before.passwordEnc))).toBe(true);
      expect(kept.version).toBe(before.version + 1);

      expect((await saveFacility(adminAToken, branchA, { code: 'CS-790010999', password: 'mat-khau-moi' })).status).toBe(200);
      const replaced = await privileged.interopFacilityCredential.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null } });
      expect(decryptPii(Buffer.from(replaced.passwordEnc), process.env.ENCRYPTION_KEY!)).toBe('mat-khau-moi');
      // chỉ MỘT dòng đang hiệu lực/chi nhánh
      expect(await privileged.interopFacilityCredential.count({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null } })).toBe(1);

      const logs = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'prescription_interop.facility_credential_saved', entityId: branchA } });
      expect(logs.length).toBe(3);
      expect(JSON.stringify(logs)).not.toMatch(/matkhau|mat-khau/);
      expect(logs.some((l) => (l.afterJson as { passwordChanged: boolean }).passwordChanged === false)).toBe(true);
    });

    it('chi nhánh B độc lập với A (mã/mật khẩu riêng)', async () => {
      expect((await saveFacility(adminAToken, branchB, { code: 'CS-B', password: 'pw-B' })).status).toBe(200);
      const list = (await http().get('/api/v1/prescription-interop/facilities').set(authed(adminAToken))).body.data.items as { branchId: string; code: string | null }[];
      expect(list.find((i) => i.branchId === branchA)!.code).toBe('CS-790010999');
      expect(list.find((i) => i.branchId === branchB)!.code).toBe('CS-B');
    });

    it('cô lập công ty: id chi nhánh của công ty khác/không tồn tại → 404 và không tạo dòng; công ty B chỉ thấy chi nhánh của mình, chưa có mã', async () => {
      const before = await privileged.interopFacilityCredential.count({ where: { tenantId: fixture.tenantA.id } });
      expect((await saveFacility(adminAToken, branchOfTenantB, { code: 'CS-LEN', password: 'x' })).status).toBe(404);
      expect((await saveFacility(adminAToken, randomUUID(), { code: 'CS-LEN', password: 'x' })).status).toBe(404);
      expect((await saveFacility(adminBToken, branchA, { code: 'CS-LEN', password: 'x' })).status).toBe(404);
      expect(await privileged.interopFacilityCredential.count({ where: { tenantId: fixture.tenantA.id } })).toBe(before);
      expect(await privileged.interopFacilityCredential.count({ where: { tenantId: fixture.tenantB.id } })).toBe(0);

      const listB = (await http().get('/api/v1/prescription-interop/facilities').set(authed(adminBToken))).body.data.items as { branchId: string; code: string | null }[];
      expect(listB.map((i) => i.branchId)).toEqual([branchOfTenantB]);
      expect(listB[0]!.code).toBeNull();
    });
  });

  describe('mã + mật khẩu của BÁC SĨ (chung công ty; chỉ nhập hộ cho bác sĩ của chi nhánh đang làm)', () => {
    it('chỉ liệt kê bác sĩ của chi nhánh đang làm (A): bác sĩ chi nhánh B và công ty B không hiện', async () => {
      const res = await http().get('/api/v1/prescription-interop/doctors').set(authed(adminAToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as { userId: string; licenseNo: string | null; code: string | null; hasPassword: boolean }[];
      const ids = items.map((i) => i.userId);
      expect(ids).toContain(doctorAId);
      expect(ids).not.toContain(doctorBranchBId);
      expect(ids).not.toContain(doctorTenantBId);
      expect(items.find((i) => i.userId === doctorAId)).toMatchObject({ licenseNo: 'CCHN-doctorA', code: null, hasPassword: false, onGateway: false, token: { status: 'NONE' } });
      expect((await http().get('/api/v1/prescription-interop/doctors').set(authed(receptionistToken))).status).toBe(403);
    });

    it('lưu: lần đầu cần mật khẩu; mật khẩu mã hoá, không trả về, nhật ký không chứa mật khẩu', async () => {
      const noPassword = await saveDoctor(adminAToken, doctorAId, { code: 'BS-0098213' });
      expect(noPassword.status).toBe(422);
      const saved = await saveDoctor(adminAToken, doctorAId, { code: 'BS-0098213', password: 'matkhau-bac-si' });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect((saved.body.data.items as { userId: string; code: string | null; hasPassword: boolean }[]).find((i) => i.userId === doctorAId)).toMatchObject({ code: 'BS-0098213', hasPassword: true });
      expect(JSON.stringify(saved.body)).not.toContain('matkhau-bac-si');

      const stored = await privileged.interopDoctorCredential.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, userId: doctorAId, deletedAt: null } });
      expect(decryptPii(Buffer.from(stored.passwordEnc), process.env.ENCRYPTION_KEY!)).toBe('matkhau-bac-si');
      const logs = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'prescription_interop.doctor_credential_saved', entityId: doctorAId } });
      expect(logs.length).toBe(1);
      expect(JSON.stringify(logs)).not.toContain('matkhau-bac-si');

      // đổi chỉ mã → giữ mật khẩu
      expect((await saveDoctor(adminAToken, doctorAId, { code: 'BS-0098214' })).status).toBe(200);
      const kept = await privileged.interopDoctorCredential.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, userId: doctorAId, deletedAt: null } });
      expect(kept.code).toBe('BS-0098214');
      expect(Buffer.from(kept.passwordEnc).equals(Buffer.from(stored.passwordEnc))).toBe(true);
    });

    it('cô lập: bác sĩ chi nhánh B (từ chi nhánh A), bác sĩ công ty B, id lạ → 404, không tạo dòng; bác sĩ tự sửa mã của mình → 403', async () => {
      expect((await saveDoctor(adminAToken, doctorBranchBId, { code: 'BS-X', password: 'x' })).status).toBe(404);
      expect((await saveDoctor(adminAToken, doctorTenantBId, { code: 'BS-X', password: 'x' })).status).toBe(404);
      expect((await saveDoctor(adminAToken, randomUUID(), { code: 'BS-X', password: 'x' })).status).toBe(404);
      expect((await saveDoctor(adminBToken, doctorAId, { code: 'BS-X', password: 'x' })).status).toBe(404);
      expect((await saveDoctor(doctorAToken, doctorAId, { code: 'BS-X', password: 'x' })).status).toBe(403);
      expect(await privileged.interopDoctorCredential.count({ where: { userId: { in: [doctorBranchBId, doctorTenantBId] } } })).toBe(0);
    });

    it('dữ liệu không hợp lệ: mã rỗng/quá dài → 400', async () => {
      expect((await saveDoctor(adminAToken, doctorAId, { code: '   ', password: 'x' })).status).toBe(400);
      expect((await saveDoctor(adminAToken, doctorAId, { code: 'a'.repeat(101), password: 'x' })).status).toBe(400);
      expect((await saveFacility(adminAToken, branchA, { code: '' })).status).toBe(400);
    });
  });
});
