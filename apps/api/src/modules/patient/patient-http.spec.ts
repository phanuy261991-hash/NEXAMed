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

  /** CCCD ngẫu nhiên hợp lệ (12 ký tự) — dùng cho các test không thật sự kiểm tra CCCD, chỉ cần
   * tránh vi phạm ràng buộc "CCCD bắt buộc từ 18 tuổi" (docs/DECISIONS.md #035) mà không đụng
   * `PATIENT_DUPLICATE_NATIONAL_ID` giữa các test case. */
  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
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

  it('tạo hồ sơ trẻ em không có CCCD (tuỳ chọn dưới 18 tuổi, PAT-01 + docs/DECISIONS.md #035) → 200, hasNationalId false', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ ...validPayload, nationalId: undefined, dob: '2015-05-20', phone: '0987000111' });

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

  it('GET danh sách (docs/DECISIONS.md #034) — nationalIdMasked chỉ lộ 4 số cuối, address xuất hiện đúng', async () => {
    const knownNationalId = '079199' + Math.floor(100000 + Math.random() * 899999);
    const created = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ ...validPayload, nationalId: knownNationalId, phone: '0900222333' });
    expect(created.status).toBe(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/patients')
      .query({ q: '0900222333' })
      .set(authed(receptionistToken));

    expect(res.status).toBe(200);
    const item = res.body.data.items.find((p: { id: string }) => p.id === created.body.data.id);
    expect(item.nationalIdMasked).toBe(`••••${knownNationalId.slice(-4)}`);
    expect(item.nationalIdMasked).not.toContain(knownNationalId.slice(0, 4));
    expect(item.address).toEqual(validPayload.address);
  });

  it('GET/PATCH theo id + optimistic locking: version cũ bị từ chối, version đúng thành công', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ ...validPayload, nationalId: randomNationalId(), phone: '0911222333' });
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
      .send({ ...validPayload, nationalId: randomNationalId(), phone: '0922333444' });
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
      .send({ ...validPayload, nationalId: randomNationalId(), phone: '0933444555' });
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

  describe('CCCD bắt buộc từ 18 tuổi lúc tạo mới (docs/DECISIONS.md #035)', () => {
    /** `dob` là chuỗi "YYYY-MM-DD" thuần, server parse bằng `new Date(dob)` (coi là UTC nửa đêm)
     * — phải dựng ngày test bằng `Date.UTC()`, không phải `new Date(y,m,d)` (giờ địa phương) rồi
     * `.toISOString()`, vì hai cách đó lệch nhau đúng 1 ngày tuỳ múi giờ máy chạy test, đủ để đổi
     * kết quả một test biên chỉ lệch 1 ngày (đã xảy ra thật lúc chạy thử). */
    function utcDateString(year: number, month: number, day: number): string {
      return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
    }

    it('bệnh nhân >= 18 tuổi (18 tuổi tròn hôm nay), không CCCD → 400 VALIDATION_ERROR', async () => {
      const today = new Date();
      const dobExactly18 = utcDateString(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate());

      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, nationalId: undefined, dob: dobExactly18, phone: '0955000111' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('bệnh nhân 17 tuổi (chưa đủ 18), không CCCD → 200, tạo được', async () => {
      const today = new Date();
      const dob17 = utcDateString(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate() + 1);

      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, nationalId: undefined, dob: dob17, phone: '0955000222' });

      expect(res.status).toBe(200);
      expect(res.body.data.hasNationalId).toBe(false);
    });

    it('bệnh nhân người lớn CÓ CCCD → 200, tạo được bình thường', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, nationalId: randomNationalId(), phone: '0955000333' });

      expect(res.status).toBe(200);
      expect(res.body.data.hasNationalId).toBe(true);
    });

    it('sửa hồ sơ người lớn đã có sẵn (không CCCD, tạo trước ràng buộc — giả lập bằng cách tạo trẻ em rồi sửa dob) → KHÔNG bị chặn bởi ràng buộc này (chỉ áp cho tạo mới)', async () => {
      const today = new Date();
      const dobChild = utcDateString(today.getUTCFullYear() - 10, today.getUTCMonth(), today.getUTCDate());
      const created = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, nationalId: undefined, dob: dobChild, phone: '0955000444' });
      expect(created.status).toBe(200);

      const dobAdult = utcDateString(today.getUTCFullYear() - 30, today.getUTCMonth(), today.getUTCDate());
      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/patients/${created.body.data.id}`)
        .set(authed(receptionistToken))
        .send({ dob: dobAdult, version: created.body.data.version });

      expect(updated.status).toBe(200);
      expect(updated.body.data.hasNationalId).toBe(false);
    });
  });

  describe('GET /api/v1/patients?q= — tìm kiếm (S2-02, PAT-02)', () => {
    let searchPatientId: string;
    const uniquePhone = '0977888999';

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, fullName: 'Đặng Thị Hồng Nhung', nationalId: randomNationalId(), phone: uniquePhone });
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
        .send({ ...validPayload, fullName: duplicateName, dob: duplicateDob, nationalId: randomNationalId(), phone: '0966777888' });
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

  describe('Mở rộng hồ sơ hành chính (docs/DECISIONS.md #034) — CCCD ngày/nơi cấp, dân tộc/quốc tịch/nghề nghiệp, số bảo hiểm, khu phố, người thân', () => {
    const extendedFields = {
      nationalIdIssuedAt: '2015-06-01',
      nationalIdIssuedPlace: 'Cục Cảnh sát QLHC về TTXH',
      ethnicity: 'Kinh',
      nationality: 'Việt Nam',
      occupation: 'Kỹ sư',
      insuranceNumber: 'BH0123456789',
      relativeFullName: 'Nguyễn Văn A',
      relativeRelationship: 'Chồng',
      relativePhone: '0900111222',
      relativeAddress: '45 Nguyễn Huệ, Q1',
    };

    it('tạo hồ sơ kèm field mở rộng → 200, lưu và trả về đúng, address có neighborhood', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({
          ...validPayload,
          nationalId: randomNationalId(),
          phone: '0911000222',
          address: { ...validPayload.address, neighborhood: 'Khu phố 3' },
          ...extendedFields,
        });

      expect(res.status).toBe(200);
      for (const [k, v] of Object.entries(extendedFields)) {
        expect(res.body.data[k]).toBe(v);
      }
      expect(res.body.data.address.neighborhood).toBe('Khu phố 3');

      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/patients/${res.body.data.id}`)
        .set(authed(receptionistToken))
        .send({ occupation: 'Bác sĩ', version: res.body.data.version });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.occupation).toBe('Bác sĩ');
      expect(patchRes.body.data.ethnicity).toBe('Kinh'); // field khác không gửi lên vẫn giữ nguyên
    });

    it('không gửi field mở rộng nào → tất cả null, không lỗi (đều optional)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, nationalId: randomNationalId(), phone: '0911000333' });

      expect(res.status).toBe(200);
      expect(res.body.data.ethnicity).toBeNull();
      expect(res.body.data.relativeFullName).toBeNull();
      expect(res.body.data.photoUrl).toBeNull();
    });
  });

  describe('POST /api/v1/patients/:id/photo — ảnh đại diện (docs/DECISIONS.md #034)', () => {
    let photoPatientId: string;
    let currentVersion: number;
    let firstPhotoUrl: string;

    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, nationalId: randomNationalId(), phone: '0955666777' });
      photoPatientId = res.body.data.id;
      currentVersion = res.body.data.version;
    });

    it('upload JPG hợp lệ → 200, photoUrl khác null, version tăng', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/patients/${photoPatientId}/photo`)
        .set(authed(receptionistToken))
        .field('version', String(currentVersion))
        .attach('file', jpegBytes, 'avatar.jpg');

      expect(res.status).toBe(200);
      expect(res.body.data.photoUrl).toBeTruthy();
      expect(res.body.data.version).toBe(currentVersion + 1);
      currentVersion = res.body.data.version;
      firstPhotoUrl = res.body.data.photoUrl;
    });

    it('ảnh vừa upload đọc được thật qua URL trả về (đúng content-type)', async () => {
      const res = await request(app.getHttpServer()).get(firstPhotoUrl);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
    });

    it('sai magic byte (nội dung không phải ảnh, dù đặt tên .jpg) → 400 PATIENT_INVALID_PHOTO', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/patients/${photoPatientId}/photo`)
        .set(authed(receptionistToken))
        .field('version', String(currentVersion))
        .attach('file', Buffer.from('day khong phai anh'), 'fake.jpg');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PATIENT_INVALID_PHOTO');
    });

    it('vượt quá 3MB → 413, không lưu được (chặn ở tầng multer trước khi tới service)', async () => {
      const bigBuffer = Buffer.alloc(3 * 1024 * 1024 + 1024, 0);
      bigBuffer[0] = 0xff;
      bigBuffer[1] = 0xd8;
      bigBuffer[2] = 0xff;
      const res = await request(app.getHttpServer())
        .post(`/api/v1/patients/${photoPatientId}/photo`)
        .set(authed(receptionistToken))
        .field('version', String(currentVersion))
        .attach('file', bigBuffer, 'big.jpg');

      expect(res.status).toBe(413);
    });

    it('version không khớp → 409 CONCURRENT_MODIFICATION', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/patients/${photoPatientId}/photo`)
        .set(authed(receptionistToken))
        .field('version', '999')
        .attach('file', jpegBytes, 'avatar.jpg');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('upload ảnh PNG thay thế → ảnh cũ đã bị xoá (URL cũ 404), ảnh mới đọc đúng', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/patients/${photoPatientId}/photo`)
        .set(authed(receptionistToken))
        .field('version', String(currentVersion))
        .attach('file', pngBytes, 'avatar.png');

      expect(res.status).toBe(200);
      const newPhotoUrl = res.body.data.photoUrl as string;
      currentVersion = res.body.data.version;

      const oldRes = await request(app.getHttpServer()).get(firstPhotoUrl);
      expect(oldRes.status).toBe(404);

      const newRes = await request(app.getHttpServer()).get(newPhotoUrl);
      expect(newRes.status).toBe(200);
      expect(newRes.headers['content-type']).toContain('image/png');
    });

    it('không có file đính kèm → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/patients/${photoPatientId}/photo`)
        .set(authed(receptionistToken))
        .field('version', String(currentVersion));

      expect(res.status).toBe(400);
    });

    it('thiếu quyền patient.update (doctor) → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/patients/${photoPatientId}/photo`)
        .set(authed(doctorToken))
        .field('version', String(currentVersion))
        .attach('file', jpegBytes, 'avatar.jpg');

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/files/:token — cách ly tenant (.claude/docs/multi-tenancy.md)', () => {
    it('token sai định dạng/hết hạn/giả mạo → 403, không tiết lộ file có tồn tại hay không', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/files/token-gia-mao-khong-hop-le');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/patients/by-phone — tra trùng SĐT (SĐT được phép trùng, Sprint 3 Tiếp nhận)', () => {
    const sharedPhone = '0977888999';

    it('2 hồ sơ cùng SĐT (mẹ dùng chung cho 2 con) → cả hai được TẠO thành công (không chặn)', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, fullName: 'Bé A', dob: '2018-01-01', nationalId: undefined, phone: sharedPhone });
      const second = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, fullName: 'Bé B', dob: '2020-01-01', nationalId: undefined, phone: sharedPhone });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/by-phone')
        .query({ phone: sharedPhone })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      const names = (res.body.data.items as Array<{ fullName: string }>).map((p) => p.fullName);
      expect(names).toEqual(expect.arrayContaining(['Bé A', 'Bé B']));
    });

    it('khớp CHÍNH XÁC số điện thoại — SĐT khác không lộ vào kết quả', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/by-phone')
        .query({ phone: '0900000000' })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
    });

    it('excludePatientId — loại chính hồ sơ đang sửa khỏi kết quả', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, fullName: 'Tự loại trừ', phone: '0977111222', nationalId: randomNationalId() });
      const id = created.body.data.id as string;

      const withoutExclude = await request(app.getHttpServer())
        .get('/api/v1/patients/by-phone')
        .query({ phone: '0977111222' })
        .set(authed(receptionistToken));
      expect(withoutExclude.body.data.items).toHaveLength(1);

      const withExclude = await request(app.getHttpServer())
        .get('/api/v1/patients/by-phone')
        .query({ phone: '0977111222', excludePatientId: id })
        .set(authed(receptionistToken));
      expect(withExclude.body.data.items).toEqual([]);
    });

    it('cách ly tenant — tenant B không thấy hồ sơ trùng SĐT của tenant A', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/by-phone')
        .query({ phone: sharedPhone })
        .set(authed(tenantBAdminToken));

      expect(res.body.data.items).toEqual([]);
    });
  });

  describe('GET /api/v1/patients/by-national-id — tra trùng CCCD (màn hình "Tiếp nhận bệnh nhân", mockup đã duyệt)', () => {
    it('khớp đúng CCCD → 200, trả đúng 1 hồ sơ', async () => {
      const nationalId = randomNationalId();
      const created = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, fullName: 'Tra theo CCCD', phone: '0988111222', nationalId });

      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/by-national-id')
        .query({ nationalId })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].id).toBe(created.body.data.id);
      expect(res.body.data.items[0].fullName).toBe('Tra theo CCCD');
    });

    it('CCCD không tồn tại → 200, mảng rỗng', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/by-national-id')
        .query({ nationalId: randomNationalId() })
        .set(authed(receptionistToken));

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
    });

    it('excludePatientId — loại chính hồ sơ đang sửa khỏi kết quả', async () => {
      const nationalId = randomNationalId();
      const created = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, fullName: 'Tự loại trừ CCCD', phone: '0988222333', nationalId });
      const id = created.body.data.id as string;

      const withExclude = await request(app.getHttpServer())
        .get('/api/v1/patients/by-national-id')
        .query({ nationalId, excludePatientId: id })
        .set(authed(receptionistToken));
      expect(withExclude.body.data.items).toEqual([]);
    });

    it('cách ly tenant — tenant B không thấy hồ sơ trùng CCCD của tenant A', async () => {
      const nationalId = randomNationalId();
      await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set(authed(receptionistToken))
        .send({ ...validPayload, fullName: 'Chỉ tenant A', phone: '0988333444', nationalId });

      const res = await request(app.getHttpServer())
        .get('/api/v1/patients/by-national-id')
        .query({ nationalId })
        .set(authed(tenantBAdminToken));

      expect(res.body.data.items).toEqual([]);
    });
  });
});
