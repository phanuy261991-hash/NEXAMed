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

/**
 * HTTP e2e cho module `patient` (S2-01) — controller nghiệp vụ đầu tiên của dự án, nên đây cũng
 * là nơi xác minh thật `PermissionGuard` (guard `data_scope` treo từ Sprint 1, xem docs/TASK.md).
 * Dùng cùng khuôn với `auth-login-http.spec.ts` (S1-07).
 */
describe('HTTP e2e — /api/v1/patients', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let doctorToken: string;
  let systemAdminToken: string;
  let tenantBAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: {
        tenantId,
        username,
        passwordHash,
        fullName: `User ${roleName}`,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });

    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
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

    fixture = await createTwoTenantFixture(privileged, 'Patient e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    doctorToken = await createUserWithRole(fixture.tenantA.id, 'doctor');
    systemAdminToken = await createUserWithRole(fixture.tenantA.id, 'system_admin');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  const validPayload = {
    fullName: 'Nguyễn Thị Bình',
    dob: '1990-05-20',
    gender: 'female',
    phone: '0912345678',
    nationalId: '001199001234',
    address: { street: '12 Lê Lợi', ward: 'Bến Nghé', district: 'Quận 1', province: 'TP.HCM' },
    allergyNote: 'Dị ứng penicillin',
  };

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/patients');
    expect(res.status).toBe(401);
  });

  it('vai trò không có patient.create (doctor) → 403 PERMISSION_DENIED kèm breakGlassAvailable', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(doctorToken))
      .send(validPayload);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
    expect(res.body.error.details.breakGlassAvailable).toBe(true);
  });

  it('receptionist tạo hồ sơ hợp lệ → 200, sinh đúng patient_code, mã hoá CCCD ở DB (không lưu plaintext)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.data.patientCode).toMatch(/^BN\d{10}$/);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.fullName).toBe(validPayload.fullName);
    expect(res.body.data.nationalId).toBe(validPayload.nationalId);
    expect(res.body.data.address).toEqual(validPayload.address);
    expect(res.body.meta).toEqual({});

    const row = await privileged.patient.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.nationalIdEnc).not.toBeNull();
    expect(row.nationalIdEnc!.toString('utf8')).not.toContain(validPayload.nationalId);
    expect(row.nationalIdHash).not.toBe(validPayload.nationalId);
  });

  it('tạo hồ sơ không có CCCD (tuỳ chọn, PAT-01) → 200, hasNationalId false', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ ...validPayload, nationalId: undefined, phone: '0987000111' });

    expect(res.status).toBe(200);
    expect(res.body.data.hasNationalId).toBe(false);
    expect(res.body.data.nationalId).toBeNull();
  });

  it('trùng CCCD trong cùng tenant → 409 PATIENT_DUPLICATE_NATIONAL_ID', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ ...validPayload, phone: '0900000000' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PATIENT_DUPLICATE_NATIONAL_ID');
  });

  it('GET danh sách → 200, thấy hồ sơ vừa tạo, không lộ nationalId trong item danh sách', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/patients').set(authed(receptionistToken));

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items[0].nationalId).toBeUndefined();
  });

  it('GET/PATCH theo id + optimistic locking: version cũ bị từ chối, version đúng thành công', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ ...validPayload, nationalId: undefined, phone: '0911222333' });
    const id = created.body.data.id as string;

    const getRes = await request(app.getHttpServer()).get(`/api/v1/patients/${id}`).set(authed(receptionistToken));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(id);

    const staleUpdate = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${id}`)
      .set(authed(receptionistToken))
      .send({ phone: '0999999999', version: 999 });
    expect(staleUpdate.status).toBe(409);
    expect(staleUpdate.body.error.code).toBe('CONCURRENT_MODIFICATION');

    const okUpdate = await request(app.getHttpServer())
      .patch(`/api/v1/patients/${id}`)
      .set(authed(receptionistToken))
      .send({ phone: '0999999999', version: 1 });
    expect(okUpdate.status).toBe(200);
    expect(okUpdate.body.data.phone).toBe('0999999999');
    expect(okUpdate.body.data.version).toBe(2);
  });

  it('vai trò không có patient.read nào (system_admin) → 403 kèm breakGlassAvailable, không có phiên break-glass thì vẫn bị chặn', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ ...validPayload, nationalId: undefined, phone: '0922333444' });
    const id = created.body.data.id as string;

    const res = await request(app.getHttpServer()).get(`/api/v1/patients/${id}`).set(authed(systemAdminToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
    expect(res.body.error.details.breakGlassAvailable).toBe(true);
  });

  it('bệnh nhân của tenant A không thấy được từ tenant B dù vai trò clinic_admin có patient.read=global → 404, không phải 403', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ ...validPayload, nationalId: undefined, phone: '0933444555' });
    const id = created.body.data.id as string;

    const res = await request(app.getHttpServer()).get(`/api/v1/patients/${id}`).set(authed(tenantBAdminToken));
    expect(res.status).toBe(404);
  });

  it('body sai định dạng (thiếu fullName) → 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ ...validPayload, fullName: undefined, phone: '0944555666' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  describe('GET /api/v1/patients?q= — tìm kiếm (S2-02, PAT-02)', () => {
    let searchPatientId: string;
    const uniquePhone = '0977888999';

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, fullName: 'Đặng Thị Hồng Nhung', nationalId: undefined, phone: uniquePhone });
      searchPatientId = res.body.data.id;
    });

    it('tìm theo tên KHÔNG dấu và không phân biệt hoa/thường → vẫn ra đúng kết quả', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients')
        .query({ q: 'dang thi hong nhung' })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((p: { id: string }) => p.id === searchPatientId)).toBe(true);
    });

    it('tìm theo một phần tên có dấu đúng nguyên bản cũng ra kết quả', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients')
        .query({ q: 'Hồng Nhung' })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((p: { id: string }) => p.id === searchPatientId)).toBe(true);
    });

    it('tìm theo số điện thoại (prefix) → ra đúng kết quả', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients')
        .query({ q: '097788' })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((p: { id: string }) => p.id === searchPatientId)).toBe(true);
    });

    it('tìm theo mã bệnh nhân (prefix, không phân biệt hoa thường) → ra đúng kết quả', async () => {
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/patients/${searchPatientId}`)
        .set(authed(receptionistToken));
      const patientCode = detail.body.data.patientCode as string;

      const res = await request(app.getHttpServer())
        .get('/api/v1/patients')
        .query({ q: patientCode.toLowerCase() })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((p: { id: string }) => p.id === searchPatientId)).toBe(true);
    });

    it('không khớp gì → trả mảng rỗng, không lỗi', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients')
        .query({ q: 'khong-ai-ten-nhu-vay-xyz-999' })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
    });

    it('tìm kiếm vẫn cách ly theo tenant — tenant B không thấy bệnh nhân của tenant A', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients')
        .query({ q: 'Hồng Nhung' })
        .set(authed(tenantBAdminToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((p: { id: string }) => p.id === searchPatientId)).toBe(false);
    });
  });

  describe('GET /api/v1/patients/check-duplicate — chống trùng mềm (S2-03, PAT-03)', () => {
    let duplicatePatientId: string;
    const duplicateName = 'Phạm Văn Cường';
    const duplicateDob = '1985-03-12';

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, fullName: duplicateName, dob: duplicateDob, nationalId: undefined, phone: '0966777888' });
      duplicatePatientId = res.body.data.id;
    });

    it('trùng tên (không dấu, không phân biệt hoa/thường) + đúng ngày sinh → trả về hồ sơ đã có, KHÔNG tạo bản ghi mới', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/check-duplicate')
        .query({ fullName: 'pham van cuong', dob: duplicateDob })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((p: { id: string }) => p.id === duplicatePatientId)).toBe(true);
    });

    it('đúng tên nhưng khác ngày sinh → không coi là trùng', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/check-duplicate')
        .query({ fullName: duplicateName, dob: '1985-03-13' })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((p: { id: string }) => p.id === duplicatePatientId)).toBe(false);
    });

    it('khác tên (chỉ gần giống, không khớp tuyệt đối) → không coi là trùng', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/check-duplicate')
        .query({ fullName: 'Phạm Văn Cường An', dob: duplicateDob })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((p: { id: string }) => p.id === duplicatePatientId)).toBe(false);
    });

    it('không tạo bản ghi mới nào khi chỉ gọi check-duplicate (chỉ cảnh báo, không chặn/không ghi)', async () => {
      const before = await privileged.patient.count({ where: { tenantId: fixture.tenantA.id } });
      await request(app.getHttpServer())
        .get('/api/v1/patients/check-duplicate')
        .query({ fullName: duplicateName, dob: duplicateDob })
        .set(authed(receptionistToken));
      const after = await privileged.patient.count({ where: { tenantId: fixture.tenantA.id } });

      expect(after).toBe(before);
    });

    it('cách ly theo tenant — tenant B không thấy bệnh nhân trùng của tenant A', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/check-duplicate')
        .query({ fullName: duplicateName, dob: duplicateDob })
        .set(authed(tenantBAdminToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((p: { id: string }) => p.id === duplicatePatientId)).toBe(false);
    });

    it('thiếu tham số bắt buộc (dob) → 400 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/check-duplicate')
        .query({ fullName: duplicateName })
        .set(authed(receptionistToken));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
