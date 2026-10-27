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
import { keyFingerprint } from '../../infrastructure/crypto/key-fingerprint';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { EncryptionKeyService } from './encryption-key.service';

/**
 * HTTP e2e cho kiểm tra khoá mã hoá hệ thống (docs/DECISIONS.md #262): mã kiểm khoá được ghi lần đầu, khoá không khớp thì ĐỌC vẫn được (trường mã hoá hiện null) còn GHI trường mã hoá bị
 * từ chối 409, hai công ty độc lập, và hệ thống cài trước bản này (chưa có mã kiểm) được tự nhận.
 */
describe('HTTP e2e — kiểm tra khoá mã hoá hệ thống', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  let keyService: EncryptionKeyService;
  const password = 'Admin@12345';

  let receptionistToken: string;
  let adminToken: string;
  let tenantBAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-key-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  const patientPayload = (nationalId: string) => ({ fullName: 'Nguyễn Thị Bình', dob: '1990-05-20', gender: 'female', phone: '0912345678', nationalId });
  let nationalIdSeq = 0;
  const newNationalId = () => `079${String(300000000 + nationalIdSeq++ * 7 + Math.floor(Math.random() * 5)).padStart(9, '0')}`;

  async function setStoredFingerprint(tenantId: string, fingerprint: string | null) {
    await privileged.tenantSetting.deleteMany({ where: { tenantId, key: 'encryption_key_fingerprint' } });
    if (fingerprint) {
      await privileged.tenantSetting.create({ data: { tenantId, key: 'encryption_key_fingerprint', valueJson: { fingerprint }, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
    keyService.clearCache();
  }

  const storedFingerprint = async (tenantId: string) =>
    ((await privileged.tenantSetting.findFirst({ where: { tenantId, key: 'encryption_key_fingerprint' } }))?.valueJson as { fingerprint?: string } | null)?.fingerprint ?? null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    keyService = app.get(EncryptionKeyService);

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();

    fixture = await createTwoTenantFixture(privileged, 'Khoa ma hoa e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    adminToken = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    tenantBAdminToken = await createUserWithRole(fixture.tenantB.id, 'clinic_admin');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  const actual = keyFingerprint(process.env.ENCRYPTION_KEY ?? '');

  it('không có access token → 401', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/encryption-key/status')).status).toBe(401);
  });

  it('công ty mới: trạng thái ổn, mã kiểm được GHI LẦN ĐẦU; quản trị thấy mã kiểm, lễ tân chỉ thấy trạng thái', async () => {
    const admin = await request(app.getHttpServer()).get('/api/v1/encryption-key/status').set(authed(adminToken));
    expect(admin.status).toBe(200);
    expect(admin.body.data).toEqual({ state: 'ok', actualFingerprint: actual, expectedFingerprint: actual, canSeeDetails: true });
    expect(await storedFingerprint(fixture.tenantA.id)).toBe(actual);

    const reception = await request(app.getHttpServer()).get('/api/v1/encryption-key/status').set(authed(receptionistToken));
    expect(reception.body.data).toEqual({ state: 'ok', actualFingerprint: null, expectedFingerprint: null, canSeeDetails: false });
  });

  it('khoá khớp: lưu CCCD bình thường', async () => {
    await setStoredFingerprint(fixture.tenantA.id, actual);
    const res = await request(app.getHttpServer()).post('/api/v1/patients').set(authed(receptionistToken)).send(patientPayload(newNationalId()));
    expect(res.status).toBe(200);
  });

  describe('khoá KHÔNG khớp (mã kiểm đã ghi khác khoá đang chạy)', () => {
    let patientId: string;

    beforeAll(async () => {
      await setStoredFingerprint(fixture.tenantA.id, actual);
      const created = await request(app.getHttpServer()).post('/api/v1/patients').set(authed(receptionistToken)).send(patientPayload(newNationalId()));
      patientId = created.body.data.id as string;
      await setStoredFingerprint(fixture.tenantA.id, '7F3A-91C2');
    });

    it('trạng thái báo mismatch kèm hai mã kiểm cho quản trị', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/encryption-key/status').set(authed(adminToken));
      expect(res.body.data).toEqual({ state: 'mismatch', actualFingerprint: actual, expectedFingerprint: '7F3A-91C2', canSeeDetails: true });
    });

    it('GHI CCCD mới (tạo hồ sơ, sửa hồ sơ) → 409 ENCRYPTION_KEY_MISMATCH, không tạo/ghi gì', async () => {
      const before = await privileged.patient.count({ where: { tenantId: fixture.tenantA.id } });
      const create = await request(app.getHttpServer()).post('/api/v1/patients').set(authed(receptionistToken)).send(patientPayload(newNationalId()));
      expect(create.status).toBe(409);
      expect(create.body.error.code).toBe('ENCRYPTION_KEY_MISMATCH');
      expect(await privileged.patient.count({ where: { tenantId: fixture.tenantA.id } })).toBe(before);

      const detail = await request(app.getHttpServer()).get(`/api/v1/patients/${patientId}`).set(authed(receptionistToken));
      const update = await request(app.getHttpServer()).patch(`/api/v1/patients/${patientId}`).set(authed(receptionistToken)).send({ version: detail.body.data.version, nationalId: newNationalId() });
      expect(update.status).toBe(409);
      expect(update.body.error.code).toBe('ENCRYPTION_KEY_MISMATCH');
    });

    it('thao tác KHÔNG đụng trường mã hoá (tạo hồ sơ trẻ em không CCCD, sửa số điện thoại) vẫn chạy bình thường', async () => {
      const child = await request(app.getHttpServer()).post('/api/v1/patients').set(authed(receptionistToken)).send({ fullName: 'Bé An', dob: '2020-01-02', gender: 'male', phone: '0987000222' });
      expect(child.status).toBe(200);
      const detail = await request(app.getHttpServer()).get(`/api/v1/patients/${patientId}`).set(authed(receptionistToken));
      const update = await request(app.getHttpServer()).patch(`/api/v1/patients/${patientId}`).set(authed(receptionistToken)).send({ version: detail.body.data.version, phone: '0911000111' });
      expect(update.status).toBe(200);
    });

    it('công ty KHÁC không bị ảnh hưởng (mã kiểm riêng từng công ty)', async () => {
      const b = await request(app.getHttpServer()).get('/api/v1/encryption-key/status').set(authed(tenantBAdminToken));
      expect(b.body.data.state).toBe('ok');
    });

    it('sửa lại mã kiểm (đặt lại đúng file khoá) → hết chặn sau khi bộ nhớ đệm làm mới', async () => {
      await setStoredFingerprint(fixture.tenantA.id, actual);
      const res = await request(app.getHttpServer()).post('/api/v1/patients').set(authed(receptionistToken)).send(patientPayload(newNationalId()));
      expect(res.status).toBe(200);
    });
  });

  describe('dữ liệu mã hoá không giải mã được (khoá sai thật) — ĐỌC không lỗi 500', () => {
    it('hồ sơ và danh sách vẫn mở được, CCCD hiện null; hệ thống cài trước bản này (chưa có mã kiểm) được nhận ra là mismatch', async () => {
      await setStoredFingerprint(fixture.tenantA.id, actual);
      const created = await request(app.getHttpServer()).post('/api/v1/patients').set(authed(receptionistToken)).send(patientPayload(newNationalId()));
      const id = created.body.data.id as string;
      // Phá MỌI dữ liệu mã hoá của công ty = như được mã hoá bằng khoá khác (kiểm tra lấy một mẫu, mọi dữ liệu đều cùng một khoá).
      await privileged.$executeRawUnsafe(`UPDATE patient SET national_id_enc = decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex') WHERE tenant_id = '${fixture.tenantA.id}' AND national_id_enc IS NOT NULL`);
      await setStoredFingerprint(fixture.tenantA.id, null);

      const detail = await request(app.getHttpServer()).get(`/api/v1/patients/${id}`).set(authed(receptionistToken));
      expect(detail.status).toBe(200);
      expect(detail.body.data.nationalId).toBeNull();
      expect(detail.body.data.hasNationalId).toBe(true);
      expect(detail.body.data.nationalIdMasked).toBeNull();

      const list = await request(app.getHttpServer()).get('/api/v1/patients').query({ q: 'Bình' }).set(authed(receptionistToken));
      expect(list.status).toBe(200);

      const status = await request(app.getHttpServer()).get('/api/v1/encryption-key/status').set(authed(adminToken));
      expect(status.body.data.state).toBe('mismatch');
      expect(status.body.data.expectedFingerprint).toBeNull(); // không biết mã gốc
      expect(await storedFingerprint(fixture.tenantA.id)).toBeNull(); // không ghi đè bằng khoá sai

      await privileged.$executeRawUnsafe(`UPDATE patient SET national_id_enc = NULL, national_id_hash = NULL WHERE tenant_id = '${fixture.tenantA.id}'`);
      await setStoredFingerprint(fixture.tenantA.id, null);
      const recovered = await request(app.getHttpServer()).get('/api/v1/encryption-key/status').set(authed(adminToken));
      expect(recovered.body.data.state).toBe('ok'); // hết dữ liệu hỏng + chưa có mã → tự ghi mã hiện tại
    });

    it('hệ thống cài trước bản này có dữ liệu giải mã được → nhận ra khoá đúng và ghi mã kiểm', async () => {
      await setStoredFingerprint(fixture.tenantA.id, null);
      const res = await request(app.getHttpServer()).get('/api/v1/encryption-key/status').set(authed(adminToken));
      expect(res.body.data.state).toBe('ok');
      expect(await storedFingerprint(fixture.tenantA.id)).toBe(actual);
    });
  });
});
