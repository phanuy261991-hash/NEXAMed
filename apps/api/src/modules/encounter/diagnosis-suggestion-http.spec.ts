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
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';

type SuggestionGroup = {
  phrase: string;
  phraseKey: string;
  expandedText: string | null;
  followUp: boolean;
  items: { icd10Code: string; icd10Name: string; reason: string; usageCount: number | null }[];
};

/**
 * HTTP e2e — "Gợi ý mã ICD-10 từ ô Chẩn đoán" (docs/DECISIONS.md): `POST /encounters/:id/diagnosis-
 * suggestions`, công tắc `icd10SuggestionEnabled`/`icd10SuggestionLearningEnabled`, "học cụm từ → mã"
 * lúc `POST .../complete`. Chạy trên danh mục ICD-10 THẬT (15.844 mã) qua migration/seed thật.
 */
describe('HTTP e2e — Gợi ý mã ICD-10 (/api/v1/encounters/:id/diagnosis-suggestions)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let clinicAdminToken: string;
  let doctorAToken: string;
  let doctorAUserId: string;
  let doctorBToken: string;
  let tenantBDoctorToken: string;
  let hourCounter = 0;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-sug-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function setSettings(body: Record<string, boolean>) {
    const res = await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(clinicAdminToken)).send(body);
    expect(res.status).toBe(200);
  }

  /** Tạo lịch + bệnh nhân (giới tính tuỳ chọn) + check-in + trả tiền + "Bắt đầu khám" + 1 chẩn đoán chính. Trả cả `version` encounter (để gọi complete). */
  async function prepareEncounter(options: { gender?: 'male' | 'female'; diagnosisCode?: string; doctorId?: string; doctorToken?: string } = {}) {
    const doctorId = options.doctorId ?? doctorAUserId;
    const doctorToken = options.doctorToken ?? doctorAToken;
    hourCounter += 1;
    const appointmentRes = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({
        doctorId,
        fullName: 'Khách e2e gợi ý ICD',
        phone: '0911222444',
        scheduledAt: new Date(Date.UTC(2026, 8, 1, hourCounter % 24, 0, 0) + Math.floor(hourCounter / 24) * 86_400_000).toISOString(),
        source: 'phone' as const,
      });
    const appointment = appointmentRes.body.data as { id: string; version: number };

    const patientRes = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({
        fullName: 'Bệnh nhân e2e gợi ý ICD',
        dob: '1990-01-01',
        gender: options.gender ?? 'male',
        phone: '0933555666',
        nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999).toString(),
      });
    const patientId = (patientRes.body.data as { id: string }).id;

    const checkInRes = await request(app.getHttpServer())
      .post('/api/v1/reception/check-in')
      .set(authed(receptionistToken))
      .send({
        appointmentId: appointment.id,
        patientId,
        version: appointment.version,
        doctorId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    const encounterId = checkInRes.body.data.id as string;
    await request(app.getHttpServer()).post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });

    const start = await request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    const version = (start.body.data as { version: number }).version;

    await request(app.getHttpServer())
      .put(`/api/v1/encounters/${encounterId}/diagnoses`)
      .set(authed(doctorToken))
      .send({ diagnoses: [{ icd10Code: options.diagnosisCode ?? 'A00', type: 'PRIMARY' as const }] });

    return { encounterId, version };
  }

  async function suggest(encounterId: string, text: string, token = doctorAToken) {
    return request(app.getHttpServer()).post(`/api/v1/encounters/${encounterId}/diagnosis-suggestions`).set(authed(token)).send({ text });
  }

  async function complete(encounterId: string, version: number, learnedPairs?: { phraseKey: string; icd10Code: string }[]) {
    return request(app.getHttpServer())
      .post(`/api/v1/encounters/${encounterId}/complete`)
      .set(authed(doctorAToken))
      .send({ version, ...(learnedPairs ? { learnedPairs } : {}) });
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

    fixture = await createTwoTenantFixture(privileged, 'ICD suggestion e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    clinicAdminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const doctorA = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorAToken = doctorA.token;
    doctorAUserId = doctorA.userId;
    doctorBToken = (await createUserWithRole(fixture.tenantA.id, 'doctor')).token;
    tenantBDoctorToken = (await createUserWithRole(fixture.tenantB.id, 'doctor')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('công tắc', () => {
    it('mặc định TẮT (cả gợi ý lẫn học); GET tự-phục vụ mọi vai trò; PATCH chỉ clinic_admin', async () => {
      const read = await request(app.getHttpServer()).get('/api/v1/clinic-settings/icd10-suggestion-enabled').set(authed(doctorAToken));
      expect(read.status).toBe(200);
      expect(read.body.data).toEqual({ enabled: false });

      const settings = await request(app.getHttpServer()).get('/api/v1/clinic-settings').set(authed(clinicAdminToken));
      expect(settings.body.data).toMatchObject({ icd10SuggestionEnabled: false, icd10SuggestionLearningEnabled: false });

      const denied = await request(app.getHttpServer()).patch('/api/v1/clinic-settings').set(authed(doctorAToken)).send({ icd10SuggestionEnabled: true });
      expect(denied.status).toBe(403);

      await setSettings({ icd10SuggestionEnabled: true });
      const after = await request(app.getHttpServer()).get('/api/v1/clinic-settings/icd10-suggestion-enabled').set(authed(doctorAToken));
      expect(after.body.data).toEqual({ enabled: true });
      await setSettings({ icd10SuggestionEnabled: false });
    });

    it('công tắc TẮT → groups rỗng dù ô Chẩn đoán có nội dung', async () => {
      const { encounterId } = await prepareEncounter();
      const res = await suggest(encounterId, 'Viêm họng cấp');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ groups: [] });
    });
  });

  describe('gợi ý (công tắc BẬT)', () => {
    beforeAll(async () => {
      await setSettings({ icd10SuggestionEnabled: true, icd10SuggestionLearningEnabled: false });
    });
    afterAll(async () => {
      await setSettings({ icd10SuggestionEnabled: false, icd10SuggestionLearningEnabled: false });
    });

    it('không có access token → 401', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/encounters/00000000-0000-0000-0000-000000000000/diagnosis-suggestions').send({ text: 'x' });
      expect(res.status).toBe(401);
    });

    it('tách 3 cụm, mở rộng viết tắt "THA", ra mã có thật trong danh mục BYT, tối đa 3 mã/cụm', async () => {
      const { encounterId } = await prepareEncounter();
      const res = await suggest(encounterId, 'Viêm họng cấp, sốt; THA');
      expect(res.status).toBe(200);
      const groups = res.body.data.groups as SuggestionGroup[];
      expect(groups.map((g) => g.phrase)).toEqual(['Viêm họng cấp', 'sốt', 'THA']);

      expect(groups[0]!.items.length).toBeLessThanOrEqual(3);
      expect(groups[0]!.items.map((i) => i.icd10Code)).toContain('J02.9');
      expect(groups[1]!.items[0]!.icd10Code).toBe('R50.9');
      expect(groups[2]).toMatchObject({ expandedText: 'tăng huyết áp', phraseKey: 'tang huyet ap' });
      expect(groups[2]!.items[0]!.icd10Code).toBe('I10');
      for (const g of groups) {
        for (const item of g.items) {
          const row = await privileged.icd10Catalog.findUnique({ where: { code: item.icd10Code } });
          expect(row?.nameVi).toBe(item.icd10Name);
          expect(row?.isBillable).toBe(true);
          expect(item.reason).toBe('MATCH');
        }
      }
    });

    it('"ĐTĐ type 2" → mã típ 2 (E11.x), KHÔNG lẫn típ 1 (E10.x) như ô tìm cũ', async () => {
      const { encounterId } = await prepareEncounter();
      const groups = (await suggest(encounterId, 'ĐTĐ type 2')).body.data.groups as SuggestionGroup[];
      const codes = groups[0]!.items.map((i) => i.icd10Code);
      expect(groups[0]!.expandedText).toBe('đái tháo đường típ 2');
      expect(codes[0]).toBe('E11.9');
      expect(codes.every((c) => c.startsWith('E11'))).toBe(true);
    });

    it('"viêm dạ dày" (có dấu) không lẫn "viêm đa dây thần kinh" (G61.8)', async () => {
      const { encounterId } = await prepareEncounter();
      const codes = ((await suggest(encounterId, 'viêm dạ dày')).body.data.groups as SuggestionGroup[])[0]!.items.map((i) => i.icd10Code);
      expect(codes.length).toBeGreaterThan(0);
      expect(codes).not.toContain('G61.8');
      expect(codes.every((c) => c.startsWith('K29'))).toBe(true);
    });

    it('lọc giới tính: "đau bụng kinh" — bệnh nhân nam không có mã N94.x; bệnh nhân nữ có', async () => {
      const male = await prepareEncounter({ gender: 'male' });
      const maleCodes = ((await suggest(male.encounterId, 'đau bụng kinh')).body.data.groups as SuggestionGroup[])[0]!.items.map((i) => i.icd10Code);
      expect(maleCodes.some((c) => c.startsWith('N94'))).toBe(false);

      const female = await prepareEncounter({ gender: 'female' });
      const femaleCodes = ((await suggest(female.encounterId, 'đau bụng kinh')).body.data.groups as SuggestionGroup[])[0]!.items.map((i) => i.icd10Code);
      expect(femaleCodes.some((c) => c.startsWith('N94'))).toBe(true);
    });

    it('tiền tố "TD" → followUp=true và vẫn tra mã theo phần bệnh còn lại; không cắt "tdcs"', async () => {
      const { encounterId } = await prepareEncounter();
      const groups = (await suggest(encounterId, 'TD sốt xuất huyết')).body.data.groups as SuggestionGroup[];
      expect(groups[0]).toMatchObject({ followUp: true, phraseKey: 'sot xuat huyet' });
      expect(groups[0]!.items.map((i) => i.icd10Code).some((c) => c.startsWith('A97'))).toBe(true);
    });

    it('ô trống hoặc chỉ ký tự phân cách → groups rỗng; text > 1000 ký tự → 400', async () => {
      const { encounterId } = await prepareEncounter();
      expect((await suggest(encounterId, '')).body.data).toEqual({ groups: [] });
      expect((await suggest(encounterId, ' ,; \n')).body.data).toEqual({ groups: [] });
      expect((await suggest(encounterId, 'a'.repeat(1001))).status).toBe(400);
    });

    it('cụm không có trong danh mục → nhóm giữ nguyên với items rỗng (UI hiện "tìm thủ công")', async () => {
      const { encounterId } = await prepareEncounter();
      const groups = (await suggest(encounterId, 'zzzxyz')).body.data.groups as SuggestionGroup[];
      expect(groups).toHaveLength(1);
      expect(groups[0]!.items).toEqual([]);
    });

    it('mã bác sĩ hay dùng (chẩn đoán ĐÃ KÝ trong 12 tháng) được cộng điểm, nhãn HISTORY kèm số lần', async () => {
      for (let i = 0; i < 3; i += 1) {
        const enc = await prepareEncounter({ diagnosisCode: 'J02.8' });
        expect((await complete(enc.encounterId, enc.version)).status).toBe(200);
      }
      const { encounterId } = await prepareEncounter();
      const items = ((await suggest(encounterId, 'viêm họng cấp')).body.data.groups as SuggestionGroup[])[0]!.items;
      expect(items[0]).toMatchObject({ icd10Code: 'J02.8', reason: 'HISTORY', usageCount: 3 });
    });

    it('lịch sử là của TỪNG bác sĩ: bác sĩ khác không thấy nhãn HISTORY của bác sĩ A', async () => {
      const otherDoctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
      const enc = await prepareEncounter({ doctorId: otherDoctor.userId, doctorToken: otherDoctor.token });
      const res = await suggest(enc.encounterId, 'viêm họng cấp', otherDoctor.token);
      expect(res.status).toBe(200);
      const items = (res.body.data.groups as SuggestionGroup[])[0]!.items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((i) => i.reason === 'HISTORY')).toBe(false);
    });

    it('lượt khám đã hoàn tất (đã ký) → groups rỗng', async () => {
      const enc = await prepareEncounter();
      expect((await complete(enc.encounterId, enc.version)).status).toBe(200);
      expect((await suggest(enc.encounterId, 'sốt')).body.data).toEqual({ groups: [] });
    });

    it('cách ly: bác sĩ tenant khác → 404; bác sĩ khác cùng tenant (scope personal) → 404', async () => {
      const { encounterId } = await prepareEncounter();
      expect((await suggest(encounterId, 'sốt', tenantBDoctorToken)).status).toBe(404);
      expect((await suggest(encounterId, 'sốt', doctorBToken)).status).toBe(404);
    });

    it('lễ tân (không có diagnosis.create) → 403', async () => {
      const { encounterId } = await prepareEncounter();
      expect((await suggest(encounterId, 'sốt', receptionistToken)).status).toBe(403);
    });
  });

  describe('"Học từ lịch sử chọn mã" (công tắc riêng)', () => {
    afterAll(async () => {
      await setSettings({ icd10SuggestionEnabled: false, icd10SuggestionLearningEnabled: false });
    });

    async function usageRows() {
      return privileged.icd10PhraseUsage.findMany({ where: { tenantId: fixture.tenantA.id, doctorId: doctorAUserId, deletedAt: null } });
    }

    it('công tắc học TẮT → "Hoàn tất khám" không ghi gì dù client gửi learnedPairs', async () => {
      await setSettings({ icd10SuggestionEnabled: true, icd10SuggestionLearningEnabled: false });
      const enc = await prepareEncounter({ diagnosisCode: 'J02.0' });
      expect((await complete(enc.encounterId, enc.version, [{ phraseKey: 'viem hong cap', icd10Code: 'J02.0' }])).status).toBe(200);
      expect(await usageRows()).toHaveLength(0);
    });

    it('công tắc học BẬT nhưng gợi ý TẮT → vẫn không ghi (học chỉ có nghĩa khi gợi ý bật)', async () => {
      await setSettings({ icd10SuggestionEnabled: false, icd10SuggestionLearningEnabled: true });
      const enc = await prepareEncounter({ diagnosisCode: 'J02.0' });
      expect((await complete(enc.encounterId, enc.version, [{ phraseKey: 'viem hong cap', icd10Code: 'J02.0' }])).status).toBe(200);
      expect(await usageRows()).toHaveLength(0);
    });

    it('BẬT cả hai: chỉ ghi cặp có mã VẪN nằm trong chẩn đoán cuối; cộng dồn số lần; sau đó gợi ý mang nhãn PHRASE_HISTORY', async () => {
      await setSettings({ icd10SuggestionEnabled: true, icd10SuggestionLearningEnabled: true });

      const first = await prepareEncounter({ diagnosisCode: 'J02.0' });
      const done1 = await complete(first.encounterId, first.version, [
        { phraseKey: 'viem hong cap', icd10Code: 'J02.0' },
        { phraseKey: 'viem hong cap', icd10Code: 'J02.0' }, // trùng lặp → chỉ tính 1
        { phraseKey: 'viem hong cap', icd10Code: 'J03.9' }, // mã đã gỡ khỏi chẩn đoán cuối → bỏ qua
      ]);
      expect(done1.status).toBe(200);
      let rows = await usageRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ phraseKey: 'viem hong cap', icd10Code: 'J02.0', usageCount: 1 });

      const second = await prepareEncounter({ diagnosisCode: 'J02.0' });
      expect((await complete(second.encounterId, second.version, [{ phraseKey: 'viem hong cap', icd10Code: 'J02.0' }])).status).toBe(200);
      rows = await usageRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ usageCount: 2, version: 2 });

      const { encounterId } = await prepareEncounter();
      const items = ((await suggest(encounterId, 'viêm họng cấp')).body.data.groups as SuggestionGroup[])[0]!.items;
      expect(items[0]).toMatchObject({ icd10Code: 'J02.0', reason: 'PHRASE_HISTORY', usageCount: 2 });
    });

    it('phraseKey sai định dạng → 400', async () => {
      const enc = await prepareEncounter({ diagnosisCode: 'J02.0' });
      const res = await complete(enc.encounterId, enc.version, [{ phraseKey: "Viêm họng'; DROP TABLE", icd10Code: 'J02.0' }]);
      expect(res.status).toBe(400);
    });

    it('cách ly tenant: dòng đã học của tenant A không hiện ở tenant B (RLS)', async () => {
      const count = await privileged.icd10PhraseUsage.count({ where: { tenantId: fixture.tenantB.id } });
      expect(count).toBe(0);
    });
  });
});
