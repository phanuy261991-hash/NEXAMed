import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — Thẻ BHYT (S2-04, docs/DECISIONS.md #243): công tắc "Áp dụng BHYT", chuẩn hoá + nhận diện hai định dạng số thẻ (12 chữ số / 15 ký tự chữ+số),
 * hạn thẻ để trống = "chưa rõ hạn", gợi ý thẻ, chụp thẻ vào lượt khám lúc Tiếp nhận (số thẻ lưu MÃ HOÁ), tìm bệnh nhân theo số thẻ, gộp hồ sơ,
 * cô lập công ty và chi nhánh (thẻ theo bệnh nhân nên CHUNG cả công ty).
 */
describe('HTTP e2e — thẻ BHYT (S2-04)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let branchA: string;
  let branchB: string;
  let receptionistToken: string;
  let nurseToken: string;
  let doctorId: string;
  let adminToken: string;
  let branchBAdminToken: string;
  let tenantBReceptionistToken: string;
  let tenantBAdminToken: string;

  const NEW_CARD = '079193004512';
  const OLD_CARD = 'DN4797915123456';

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  async function setInsurance(token: string, enabled: boolean) {
    const res = await http().patch('/api/v1/clinic-settings').set(authed(token)).send({ insuranceEnabled: enabled });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  async function createPatient(token: string, overrides: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/v1/patients')
      .set(authed(token))
      .send({ fullName: 'Bệnh nhân thẻ BHYT', dob: '1990-01-01', gender: 'female', phone: '0933444555', nationalId: randomNationalId(), ...overrides });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { id: string };
  }

  async function addCard(token: string, patientId: string, body: Record<string, unknown>) {
    return http().post(`/api/v1/patients/${patientId}/insurance-cards`).set(authed(token)).send(body);
  }

  async function listCards(token: string, patientId: string) {
    return http().get(`/api/v1/patients/${patientId}/insurance-cards`).set(authed(token));
  }

  function register(token: string, patientId: string, overrides: Record<string, unknown> = {}) {
    return http()
      .post('/api/v1/reception/direct')
      .set(authed(token))
      .send({
        patientId,
        doctorId,
        checkedInAt: new Date().toISOString(),
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
        ...overrides,
      });
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

    fixture = await createTwoTenantFixture(privileged, 'Insurance card e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    branchA = (await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true }, select: { id: true } })).id;
    branchB = (
      await privileged.branch.create({
        data: { tenantId: fixture.tenantA.id, code: 'CN00002', name: 'Chi nhánh B (thẻ BHYT)', isDefault: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      })
    ).id;

    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'ins-recep', [branchA]);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'ins-doctor', [branchA]);
    const nurse = await h.createUser(fixture.tenantA.id, { name: 'nurse' }, 'ins-nurse', [branchA]);
    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'ins-admin', [branchA]);
    const adminB = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'ins-adminB', [branchB]);
    const tenantBReceptionist = await h.createUser(fixture.tenantB.id, { name: 'receptionist' }, 'ins-recepB', []);
    const tenantBAdmin = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'ins-adminTB', []);
    doctorId = doctor.id;
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    nurseToken = await h.login(fixture.tenantA.id, nurse.username);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    branchBAdminToken = await h.login(fixture.tenantA.id, adminB.username);
    tenantBReceptionistToken = await h.login(fixture.tenantB.id, tenantBReceptionist.username);
    tenantBAdminToken = await h.login(fixture.tenantB.id, tenantBAdmin.username);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('công tắc "Áp dụng BHYT"', () => {
    it('mặc định TẮT; mọi nhân viên đọc được trạng thái; chỉ người có clinic_config.update bật được', async () => {
      const read = await http().get('/api/v1/clinic-settings/insurance-enabled').set(authed(receptionistToken));
      expect(read.status).toBe(200);
      expect(read.body.data).toEqual({ enabled: false });

      const denied = await http().patch('/api/v1/clinic-settings').set(authed(receptionistToken)).send({ insuranceEnabled: true });
      expect(denied.status).toBe(403);

      expect((await http().get('/api/v1/clinic-settings/insurance-enabled')).status).toBe(401);
    });

    it('TẮT → thêm/sửa/xoá/ảnh thẻ đều 409 INSURANCE_DISABLED; danh sách vẫn đọc được và báo enabled=false', async () => {
      const patient = await createPatient(receptionistToken);
      const add = await addCard(receptionistToken, patient.id, { cardNo: NEW_CARD });
      expect(add.status).toBe(409);
      expect(add.body.error.code).toBe('INSURANCE_DISABLED');

      const list = await listCards(receptionistToken, patient.id);
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual({ enabled: false, items: [], suggestedCardId: null });

      expect((await http().patch(`/api/v1/patients/${patient.id}/insurance-cards/${randomUUID()}`).set(authed(receptionistToken)).send({ version: 1 })).status).toBe(409);
      expect((await http().delete(`/api/v1/patients/${patient.id}/insurance-cards/${randomUUID()}?version=1`).set(authed(receptionistToken))).status).toBe(409);
    });
  });

  describe('thẻ BHYT khi công tắc BẬT', () => {
    beforeAll(async () => {
      await setInsurance(adminToken, true);
    });
    afterAll(async () => {
      await setInsurance(adminToken, false);
    });

    it('thẻ mới 12 số: chuẩn hoá khoảng trắng/gạch nối, nhận diện NEW_12, số thẻ lưu MÃ HOÁ ở DB', async () => {
      const patient = await createPatient(receptionistToken);
      const res = await addCard(receptionistToken, patient.id, { cardNo: ' 079 193-004 512 ', benefitRate: 80, facilityCode: '79124', facilityName: 'Trạm Y tế Phường 12' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.card).toMatchObject({ cardNo: NEW_CARD, kind: 'NEW_12', validity: 'UNKNOWN_EXPIRY', validFrom: null, validTo: null, benefitRate: 80, facilityCode: '79124', version: 1 });
      expect(res.body.data.warnings).toEqual([]);

      const row = await privileged.insuranceCard.findUniqueOrThrow({ where: { id: res.body.data.card.id } });
      expect(Buffer.from(row.cardNoEnc).toString('utf8')).not.toContain(NEW_CARD);
      expect(row.cardNoHash).not.toContain(NEW_CARD);
      expect(row.cardNoHash.length).toBeGreaterThan(20);
    });

    it('thẻ cũ 15 ký tự chữ+số: chữ thường tự đổi sang chữ hoa, nhận diện OLD_15', async () => {
      const patient = await createPatient(receptionistToken);
      const res = await addCard(receptionistToken, patient.id, { cardNo: 'dn4797915123456', validFrom: '2026-01-01', validTo: '2099-12-31' });
      expect(res.status).toBe(200);
      expect(res.body.data.card).toMatchObject({ cardNo: OLD_CARD, kind: 'OLD_15', validity: 'VALID' });
    });

    it('sai định dạng (10 chữ số, 12 ký tự có chữ) → vẫn lưu, cảnh báo UNRECOGNIZED_FORMAT, kind UNKNOWN', async () => {
      const patient = await createPatient(receptionistToken);
      const a = await addCard(receptionistToken, patient.id, { cardNo: '0791930045' });
      expect(a.status).toBe(200);
      expect(a.body.data.card.kind).toBe('UNKNOWN');
      expect(a.body.data.warnings).toEqual(['UNRECOGNIZED_FORMAT']);
      const b = await addCard(receptionistToken, patient.id, { cardNo: '07919300451A' });
      expect(b.body.data.card.kind).toBe('UNKNOWN');
    });

    it('trùng đúng một số thẻ của cùng bệnh nhân → lưu được nhưng cảnh báo DUPLICATE_CARD_NO', async () => {
      const patient = await createPatient(receptionistToken);
      await addCard(receptionistToken, patient.id, { cardNo: NEW_CARD });
      const second = await addCard(receptionistToken, patient.id, { cardNo: '079-193-004-512' });
      expect(second.status).toBe(200);
      expect(second.body.data.warnings).toEqual(['DUPLICATE_CARD_NO']);
      expect((await listCards(receptionistToken, patient.id)).body.data.items).toHaveLength(2);
    });

    it('dữ liệu sai: số thẻ rỗng / chỉ gạch nối / hạn trước ngày bắt đầu / mã cơ sở không đủ 5 số / mức hưởng > 100 → 400', async () => {
      const patient = await createPatient(receptionistToken);
      for (const body of [
        { cardNo: '' },
        { cardNo: '- -' },
        { cardNo: NEW_CARD, validFrom: '2026-06-01', validTo: '2026-05-01' },
        { cardNo: NEW_CARD, facilityCode: '1234' },
        { cardNo: NEW_CARD, benefitRate: 101 },
      ]) {
        const res = await addCard(receptionistToken, patient.id, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
    });

    it('phân quyền: điều dưỡng đọc được (patient.read) nhưng không thêm được (không có patient.update → 403)', async () => {
      const patient = await createPatient(receptionistToken);
      expect((await listCards(nurseToken, patient.id)).status).toBe(200);
      expect((await addCard(nurseToken, patient.id, { cardNo: NEW_CARD })).status).toBe(403);
      expect((await http().get(`/api/v1/patients/${patient.id}/insurance-cards`)).status).toBe(401);
    });

    it('danh sách: hiệu lực từng thẻ + thẻ gợi ý ưu tiên "còn hiệu lực" hơn "chưa rõ hạn"; hết hạn/chưa hiệu lực không được gợi ý', async () => {
      const patient = await createPatient(receptionistToken);
      const valid = (await addCard(receptionistToken, patient.id, { cardNo: OLD_CARD, validFrom: '2026-01-01', validTo: '2099-12-31' })).body.data.card;
      await addCard(receptionistToken, patient.id, { cardNo: 'HC4797915000001', validFrom: '2020-01-01', validTo: '2020-12-31' });
      await addCard(receptionistToken, patient.id, { cardNo: 'GD4797915000002', validFrom: '2090-01-01', validTo: '2095-12-31' });
      const unknown = (await addCard(receptionistToken, patient.id, { cardNo: NEW_CARD })).body.data.card;

      const list = await listCards(receptionistToken, patient.id);
      const byNo = Object.fromEntries((list.body.data.items as { cardNo: string; validity: string }[]).map((c) => [c.cardNo, c.validity]));
      expect(byNo).toEqual({ [OLD_CARD]: 'VALID', HC4797915000001: 'EXPIRED', GD4797915000002: 'NOT_STARTED', [NEW_CARD]: 'UNKNOWN_EXPIRY' });
      expect(list.body.data.suggestedCardId).toBe(valid.id);

      // Xoá thẻ còn hiệu lực → thẻ "chưa rõ hạn" được gợi ý.
      const removed = await http().delete(`/api/v1/patients/${patient.id}/insurance-cards/${valid.id}?version=${valid.version}`).set(authed(receptionistToken));
      expect(removed.status).toBe(200);
      expect((await listCards(receptionistToken, patient.id)).body.data.suggestedCardId).toBe(unknown.id);
    });

    it('sửa thẻ: tăng version, đổi số thẻ đổi cả mã băm, xoá hạn bằng null; lệch version → 409; xoá mềm không xoá cứng', async () => {
      const patient = await createPatient(receptionistToken);
      const card = (await addCard(receptionistToken, patient.id, { cardNo: NEW_CARD, validFrom: '2026-01-01', validTo: '2026-12-31' })).body.data.card;
      const before = await privileged.insuranceCard.findUniqueOrThrow({ where: { id: card.id } });

      const upd = await http()
        .patch(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}`)
        .set(authed(receptionistToken))
        .send({ version: card.version, cardNo: 'dn4797915123456', validTo: null, benefitRate: 95 });
      expect(upd.status, JSON.stringify(upd.body)).toBe(200);
      expect(upd.body.data.card).toMatchObject({ cardNo: OLD_CARD, kind: 'OLD_15', validTo: null, validFrom: '2026-01-01', benefitRate: 95, version: 2 });
      const after = await privileged.insuranceCard.findUniqueOrThrow({ where: { id: card.id } });
      expect(after.cardNoHash).not.toBe(before.cardNoHash);

      const stale = await http().patch(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}`).set(authed(receptionistToken)).send({ version: 1, benefitRate: 100 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');

      const badRange = await http().patch(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}`).set(authed(receptionistToken)).send({ version: 2, validTo: '2025-01-01' });
      expect(badRange.status).toBe(400);

      const del = await http().delete(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}?version=2`).set(authed(receptionistToken));
      expect(del.status).toBe(200);
      const gone = await privileged.insuranceCard.findUniqueOrThrow({ where: { id: card.id } });
      expect(gone.deletedAt).not.toBeNull();
      expect(gone.deletedReason).toBe('removed');
      expect((await listCards(receptionistToken, patient.id)).body.data.items).toEqual([]);
      expect((await http().delete(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}?version=3`).set(authed(receptionistToken))).status).toBe(404);
    });

    it('ảnh thẻ: nhận JPG/PNG (kiểm magic byte), từ chối file giả; có URL ký cho từng mặt', async () => {
      const patient = await createPatient(receptionistToken);
      const card = (await addCard(receptionistToken, patient.id, { cardNo: NEW_CARD })).body.data.card;
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

      const ok = await http()
        .post(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}/photo`)
        .set(authed(receptionistToken))
        .field('side', 'front')
        .field('version', String(card.version))
        .attach('file', png, { filename: 'the.png', contentType: 'image/png' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.card.photoFrontUrl).toMatch(/^\/api\/v1\/files\//);
      expect(ok.body.data.card.photoBackUrl).toBeNull();
      expect(ok.body.data.card.version).toBe(card.version + 1);

      const fake = await http()
        .post(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}/photo`)
        .set(authed(receptionistToken))
        .field('side', 'back')
        .field('version', String(card.version + 1))
        .attach('file', Buffer.from('không phải ảnh'), { filename: 'the.png', contentType: 'image/png' });
      expect(fake.status).toBe(400);
    });

    it('tìm bệnh nhân theo số thẻ: khớp CHÍNH XÁC, chịu chữ thường/khoảng trắng; số khác không ra; công tắc tắt thì không tìm theo thẻ', async () => {
      const uniqueNew = String(Math.floor(100000000000 + Math.random() * 899999999999));
      const patient = await createPatient(receptionistToken, { fullName: 'Người có thẻ để tìm' });
      await addCard(receptionistToken, patient.id, { cardNo: uniqueNew });

      const hit = await http().get('/api/v1/patients').query({ q: uniqueNew }).set(authed(receptionistToken));
      expect(hit.status).toBe(200);
      expect((hit.body.data.items as { id: string }[]).map((p) => p.id)).toContain(patient.id);

      const spaced = await http().get('/api/v1/patients').query({ q: `${uniqueNew.slice(0, 4)} ${uniqueNew.slice(4)}` }).set(authed(receptionistToken));
      expect((spaced.body.data.items as { id: string }[]).map((p) => p.id)).toContain(patient.id);

      const other = await http().get('/api/v1/patients').query({ q: '999999999999' }).set(authed(receptionistToken));
      expect((other.body.data.items as { id: string }[]).map((p) => p.id)).not.toContain(patient.id);

      await setInsurance(adminToken, false);
      const off = await http().get('/api/v1/patients').query({ q: uniqueNew }).set(authed(receptionistToken));
      expect((off.body.data.items as { id: string }[]).map((p) => p.id)).not.toContain(patient.id);
      await setInsurance(adminToken, true);
    });

    it('CÔ LẬP CÔNG TY: công ty khác không đọc/sửa/xoá thẻ (404) và không tìm ra bệnh nhân qua số thẻ', async () => {
      const uniqueNew = String(Math.floor(100000000000 + Math.random() * 899999999999));
      const patient = await createPatient(receptionistToken);
      const card = (await addCard(receptionistToken, patient.id, { cardNo: uniqueNew })).body.data.card;
      await setInsurance(tenantBAdminToken, true);

      expect((await listCards(tenantBReceptionistToken, patient.id)).status).toBe(404);
      expect((await addCard(tenantBReceptionistToken, patient.id, { cardNo: NEW_CARD })).status).toBe(404);
      expect((await http().patch(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}`).set(authed(tenantBReceptionistToken)).send({ version: 1, benefitRate: 50 })).status).toBe(404);
      expect((await http().delete(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}?version=1`).set(authed(tenantBReceptionistToken))).status).toBe(404);
      const search = await http().get('/api/v1/patients').query({ q: uniqueNew }).set(authed(tenantBReceptionistToken));
      expect((search.body.data.items as { id: string }[]).map((p) => p.id)).not.toContain(patient.id);
      // Thẻ của công ty A không bị công ty B làm đổi.
      expect(await privileged.insuranceCard.count({ where: { tenantId: fixture.tenantB.id } })).toBe(0);
    });

    it('CHI NHÁNH: thẻ theo bệnh nhân nên CHUNG cả công ty — người ở chi nhánh B thấy và sửa được thẻ thêm ở chi nhánh A', async () => {
      const patient = await createPatient(receptionistToken);
      const card = (await addCard(receptionistToken, patient.id, { cardNo: NEW_CARD })).body.data.card;
      const fromB = await listCards(branchBAdminToken, patient.id);
      expect(fromB.status).toBe(200);
      expect(fromB.body.data.items).toHaveLength(1);
      const upd = await http().patch(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}`).set(authed(branchBAdminToken)).send({ version: 1, benefitRate: 100 });
      expect(upd.status).toBe(200);
      expect(upd.body.data.card.benefitRate).toBe(100);
    });

    it('gộp hồ sơ: mọi thẻ của hồ sơ nguồn chuyển sang hồ sơ đích; hồ sơ đã gộp không nhận thêm thẻ (409)', async () => {
      const source = await createPatient(adminToken, { fullName: 'Hồ sơ nguồn' });
      const target = await createPatient(adminToken, { fullName: 'Hồ sơ đích' });
      await addCard(adminToken, source.id, { cardNo: NEW_CARD });
      await addCard(adminToken, target.id, { cardNo: OLD_CARD });

      const merge = await http().post('/api/v1/patients/merge').set(authed(adminToken)).send({ sourceId: source.id, targetId: target.id });
      expect(merge.status, JSON.stringify(merge.body)).toBe(200);
      const merged = (await listCards(adminToken, target.id)).body.data.items as { cardNo: string }[];
      expect(merged.map((c) => c.cardNo).sort()).toEqual([NEW_CARD, OLD_CARD].sort());
      expect((await listCards(adminToken, source.id)).body.data.items).toEqual([]);

      const afterMerge = await addCard(adminToken, source.id, { cardNo: NEW_CARD });
      expect(afterMerge.status).toBe(409);
      expect(afterMerge.body.error.code).toBe('PATIENT_ALREADY_MERGED');
    });
  });

  describe('dữ liệu in: phiếu thu + đơn thuốc đọc thẻ ĐÃ CHỤP của lượt khám', () => {
    beforeAll(async () => {
      await setInsurance(adminToken, true);
    });
    afterAll(async () => {
      await setInsurance(adminToken, false);
    });

    it('phiếu thu: trả thẻ đã chụp (số thẻ giải mã); công tắc tắt → null; chi nhánh khác và công ty khác → 404', async () => {
      const patient = await createPatient(receptionistToken);
      await addCard(receptionistToken, patient.id, { cardNo: NEW_CARD, benefitRate: 80, facilityName: 'Trạm Y tế Phường 12' });
      const enc = await register(receptionistToken, patient.id);
      expect(enc.status, JSON.stringify(enc.body)).toBe(200);
      const encId = enc.body.data.id as string;

      const res = await http().get(`/api/v1/billing/invoices/${encId}/insurance`).set(authed(adminToken));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ selfPay: false, cardNo: NEW_CARD, kind: 'NEW_12', benefitRate: 80, facilityName: 'Trạm Y tế Phường 12' });

      expect((await http().get(`/api/v1/billing/invoices/${encId}/insurance`).set(authed(branchBAdminToken))).status).toBe(404);
      expect((await http().get(`/api/v1/billing/invoices/${encId}/insurance`).set(authed(tenantBAdminToken))).status).toBe(404);
      expect((await http().get(`/api/v1/billing/invoices/${encId}/insurance`)).status).toBe(401);

      await setInsurance(adminToken, false);
      const off = await http().get(`/api/v1/billing/invoices/${encId}/insurance`).set(authed(adminToken));
      expect(off.status).toBe(200);
      expect(off.body.data).toBeNull();
      await setInsurance(adminToken, true);
    });

    it('đơn thuốc in: prescription-print-info mang thẻ đã chụp; công tắc tắt → null; tự chi trả → selfPay không có số thẻ', async () => {
      const patient = await createPatient(receptionistToken);
      await addCard(receptionistToken, patient.id, { cardNo: OLD_CARD, validFrom: '2026-01-01', validTo: '2099-12-31', benefitRate: 95 });
      const enc = await register(receptionistToken, patient.id);
      const encId = enc.body.data.id as string;
      const info = await http().get(`/api/v1/encounters/${encId}/prescription-print-info`).set(authed(adminToken));
      expect(info.status, JSON.stringify(info.body)).toBe(200);
      expect(info.body.data.insurance).toMatchObject({ selfPay: false, cardNo: OLD_CARD, kind: 'OLD_15', benefitRate: 95, validTo: '2099-12-31' });

      const noCard = await createPatient(receptionistToken);
      const enc2 = await register(receptionistToken, noCard.id);
      const info2 = await http().get(`/api/v1/encounters/${enc2.body.data.id}/prescription-print-info`).set(authed(adminToken));
      expect(info2.body.data.insurance).toMatchObject({ selfPay: true, reason: 'NO_CARD', cardNo: null, kind: null });

      await setInsurance(adminToken, false);
      const off = await http().get(`/api/v1/encounters/${encId}/prescription-print-info`).set(authed(adminToken));
      expect(off.body.data.insurance).toBeNull();
      await setInsurance(adminToken, true);
    });
  });

  describe('Tiếp nhận: chụp thẻ vào lượt khám', () => {
    async function snapshotOf(encounterId: string) {
      return (await privileged.encounter.findUniqueOrThrow({ where: { id: encounterId }, select: { insuranceSnapshot: true } })).insuranceSnapshot as Record<string, unknown>;
    }

    it('công tắc TẮT: lượt khám ghi đúng { selfPay: true } như trước; danh sách/màn khám không mang nhãn BHYT', async () => {
      const patient = await createPatient(receptionistToken);
      const res = await register(receptionistToken, patient.id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await snapshotOf(res.body.data.id)).toEqual({ selfPay: true });

      const list = await http().get('/api/v1/reception/list').set(authed(receptionistToken));
      const item = (list.body.data.items as { encounterId: string; insurance: unknown }[]).find((i) => i.encounterId === res.body.data.id);
      expect(item?.insurance).toBeNull();
      const consult = await http().get(`/api/v1/encounters/${res.body.data.id}/consultation`).set(authed(adminToken));
      expect(consult.body.data.insurance).toBeNull();
    });

    describe('công tắc BẬT', () => {
      beforeAll(async () => {
        await setInsurance(adminToken, true);
      });
      afterAll(async () => {
        await setInsurance(adminToken, false);
      });

      it('không chọn thẻ → tự gợi ý thẻ còn hiệu lực; số thẻ trong bản chụp được MÃ HOÁ, API giải mã khi đọc (màn khám, danh sách, lịch sử khám)', async () => {
        const patient = await createPatient(receptionistToken);
        const card = (await addCard(receptionistToken, patient.id, { cardNo: OLD_CARD, validFrom: '2026-01-01', validTo: '2099-12-31', benefitRate: 80, facilityCode: '79005', facilityName: 'PK Tân Bình' })).body.data.card;
        const res = await register(receptionistToken, patient.id);
        expect(res.status, JSON.stringify(res.body)).toBe(200);

        const snap = await snapshotOf(res.body.data.id);
        expect(snap).toMatchObject({ selfPay: false, cardId: card.id, validFrom: '2026-01-01', validTo: '2099-12-31', benefitRate: 80, facilityCode: '79005' });
        expect(JSON.stringify(snap)).not.toContain(OLD_CARD);
        expect(typeof snap.cardNoEnc).toBe('string');

        const consult = await http().get(`/api/v1/encounters/${res.body.data.id}/consultation`).set(authed(adminToken));
        expect(consult.body.data.insurance).toMatchObject({ selfPay: false, reason: null, cardNo: OLD_CARD, kind: 'OLD_15', benefitRate: 80, facilityName: 'PK Tân Bình' });

        const list = await http().get('/api/v1/reception/list').set(authed(receptionistToken));
        const item = (list.body.data.items as { encounterId: string; insurance: unknown }[]).find((i) => i.encounterId === res.body.data.id);
        expect(item?.insurance).toEqual({ selfPay: false, benefitRate: 80 });
        expect(JSON.stringify(list.body.data)).not.toContain(OLD_CARD);

        const history = await http().get(`/api/v1/encounters/by-patient/${patient.id}/history`).query({ status: 'ALL' }).set(authed(receptionistToken));
        expect(history.status, JSON.stringify(history.body)).toBe(200);
        const row = (history.body.data.items as { encounterId: string; insurance: { cardNo: string } | null }[]).find((i) => i.encounterId === res.body.data.id);
        expect(row?.insurance?.cardNo).toBe(OLD_CARD);
      });

      it('thẻ bị đổi/xoá sau đó KHÔNG làm đổi bản chụp của lượt khám cũ', async () => {
        const patient = await createPatient(receptionistToken);
        const card = (await addCard(receptionistToken, patient.id, { cardNo: NEW_CARD, benefitRate: 80 })).body.data.card;
        const res = await register(receptionistToken, patient.id);
        await http().patch(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}`).set(authed(receptionistToken)).send({ version: 1, cardNo: OLD_CARD, benefitRate: 50 });
        await http().delete(`/api/v1/patients/${patient.id}/insurance-cards/${card.id}?version=2`).set(authed(receptionistToken));
        const consult = await http().get(`/api/v1/encounters/${res.body.data.id}/consultation`).set(authed(adminToken));
        expect(consult.body.data.insurance).toMatchObject({ cardNo: NEW_CARD, benefitRate: 80, selfPay: false });
      });

      it('insuranceCardId=null ("Không dùng thẻ") → tự chi trả lý do DECLINED, không chụp thẻ', async () => {
        const patient = await createPatient(receptionistToken);
        await addCard(receptionistToken, patient.id, { cardNo: NEW_CARD, benefitRate: 80 });
        const res = await register(receptionistToken, patient.id, { insuranceCardId: null });
        expect(await snapshotOf(res.body.data.id)).toEqual({ selfPay: true, reason: 'DECLINED' });
      });

      it('chưa có thẻ → NO_CARD; thẻ hết hạn (kể cả lễ tân chọn tay) → EXPIRED; chọn thẻ của bệnh nhân khác → 404', async () => {
        const empty = await createPatient(receptionistToken);
        expect(await snapshotOf((await register(receptionistToken, empty.id)).body.data.id)).toEqual({ selfPay: true, reason: 'NO_CARD' });

        const patient = await createPatient(receptionistToken);
        const expired = (await addCard(receptionistToken, patient.id, { cardNo: OLD_CARD, validFrom: '2020-01-01', validTo: '2020-12-31' })).body.data.card;
        expect(await snapshotOf((await register(receptionistToken, patient.id)).body.data.id)).toEqual({ selfPay: true, reason: 'EXPIRED' });
        const manual = await register(receptionistToken, patient.id, { insuranceCardId: expired.id });
        expect(await snapshotOf(manual.body.data.id)).toEqual({ selfPay: true, reason: 'EXPIRED' });

        const other = await createPatient(receptionistToken);
        const foreign = await register(receptionistToken, other.id, { insuranceCardId: expired.id });
        expect(foreign.status).toBe(404);
      });

      it('chọn tay thẻ "chưa rõ hạn" cho lượt khám → chụp bình thường (BHYT)', async () => {
        const patient = await createPatient(receptionistToken);
        const unknown = (await addCard(receptionistToken, patient.id, { cardNo: NEW_CARD, benefitRate: 95 })).body.data.card;
        const res = await register(receptionistToken, patient.id, { insuranceCardId: unknown.id });
        expect(await snapshotOf(res.body.data.id)).toMatchObject({ selfPay: false, cardId: unknown.id, benefitRate: 95 });
      });

      it('CÔ LẬP CÔNG TY: công ty khác không chọn được thẻ của công ty này (id lạ → 404)', async () => {
        const patientA = await createPatient(receptionistToken);
        const card = (await addCard(receptionistToken, patientA.id, { cardNo: NEW_CARD })).body.data.card;
        await setInsurance(tenantBAdminToken, true);
        const patientB = await createPatient(tenantBReceptionistToken);
        const doctorB = await h.createUser(fixture.tenantB.id, { name: 'doctor' }, 'ins-docB', []);
        const res = await http()
          .post('/api/v1/reception/direct')
          .set(authed(tenantBReceptionistToken))
          .send({
            patientId: patientB.id,
            doctorId: doctorB.id,
            checkedInAt: new Date().toISOString(),
            services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
            receptionTypeCode: 'RT_NEW',
            examFormCode: 'EF_NORMAL',
            insuranceCardId: card.id,
          });
        expect(res.status).toBe(404);
      });
    });
  });
});
