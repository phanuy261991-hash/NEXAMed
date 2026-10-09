import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { addDaysToDateString, getVietnamDateString } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — Điều trị & Hẹn tái khám (docs/DECISIONS.md #222): Kết luận / Nội dung điều trị / Lời dặn (3 mục `clinical_note`), Hướng điều trị + ngày hẹn tái khám
 * (`encounter_treatment_plan`, bản ký) lưu cùng `PUT clinical-note`, ký khi Hoàn tất khám, đính chính cùng lý do; và "Mẫu lời dặn" (`/advice-templates`).
 */
describe('HTTP e2e — Điều trị & Hẹn tái khám + Mẫu lời dặn (#222)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let receptionistToken: string;
  let nurseToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let otherDoctorToken: string;
  let tenantBDoctorToken: string;
  let tenantBAdminToken: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const randomNationalId = (): string => '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  const noteUrl = (id: string) => `/api/v1/encounters/${id}/clinical-note`;
  const today = () => getVietnamDateString();
  const inDays = (n: number) => addDaysToDateString(today(), n)!;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-tp-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  /** Tiếp nhận (thu tiền ngay) + bắt đầu khám. `checkedInAt` = bây giờ → ngày khám = hôm nay (giờ Việt Nam). */
  async function prepareEncounter(): Promise<string> {
    const patientRes = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e điều trị', dob: '1985-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
    const checkIn = await http()
      .post('/api/v1/reception/direct')
      .set(authed(receptionistToken))
      .send({
        patientId: patientRes.body.data.id,
        doctorId: doctorUserId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
        checkedInAt: new Date().toISOString(),
      });
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
    const encounterId = checkIn.body.data.id as string;
    await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
    const start = await http().post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    return encounterId;
  }

  type SaveBody = Record<string, unknown>;
  const baseNote = (extra: SaveBody = {}): SaveBody => ({
    reasonForVisit: { content: 'Ho kéo dài' },
    illnessProgress: { content: '' },
    preliminaryDiagnosis: { content: 'Viêm phế quản cấp' },
    generalExam: { content: '' },
    regionalExam: { content: '' },
    plan: { content: '' },
    ...extra,
  });
  const saveNote = (encounterId: string, body: SaveBody, token = doctorToken) => http().put(noteUrl(encounterId)).set(authed(token)).send(body);
  const consultation = async (encounterId: string, token = doctorToken) => {
    const res = await http().get(`/api/v1/encounters/${encounterId}/consultation`).set(authed(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    type NoteValue = { version: number; signedAt: string | null; followUpDate: string | null; content: string };
    return res.body.data as { encounter: { version: number }; clinicalNote: Record<'reasonForVisit' | 'illnessProgress' | 'preliminaryDiagnosis' | 'generalExam' | 'regionalExam' | 'plan' | 'conclusion' | 'doctorAdvice' | 'treatmentPlan', NoteValue> };
  };
  async function complete(encounterId: string) {
    const dx = await http().put(`/api/v1/encounters/${encounterId}/diagnoses`).set(authed(doctorToken)).send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' }] });
    expect(dx.status, JSON.stringify(dx.body)).toBe(200);
    const detail = await consultation(encounterId);
    const done = await http().post(`/api/v1/encounters/${encounterId}/complete`).set(authed(doctorToken)).send({ version: detail.encounter.version });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
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

    fixture = await createTwoTenantFixture(privileged, 'TreatmentPlan e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    nurseToken = (await createUserWithRole(fixture.tenantA.id, 'nurse')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;
    otherDoctorToken = (await createUserWithRole(fixture.tenantA.id, 'doctor')).token;
    tenantBDoctorToken = (await createUserWithRole(fixture.tenantB.id, 'doctor')).token;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('lưu cùng ghi chú khám', () => {
    it('lưu Kết luận + Nội dung điều trị + Lời dặn + hướng điều trị (nhiều hướng) + ngày hẹn; đọc lại đúng; sửa kèm version; version cũ → 409', async () => {
      const id = await prepareEncounter();
      const followUp = inDays(7);
      const saved = await saveNote(
        id,
        baseNote({
          conclusion: { content: 'Viêm phế quản cấp, chưa biến chứng' },
          plan: { content: 'Kháng sinh 7 ngày' },
          doctorAdvice: { content: 'Giữ ấm, tránh khói bụi' },
          treatmentPlan: { directions: ['PRESCRIPTION', 'FOLLOW_UP'], followUpDate: followUp },
        }),
      );
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const note = saved.body.data;
      expect(note.conclusion.content).toBe('Viêm phế quản cấp, chưa biến chứng');
      expect(note.doctorAdvice.content).toBe('Giữ ấm, tránh khói bụi');
      expect(note.plan.content).toBe('Kháng sinh 7 ngày');
      expect(note.treatmentPlan).toMatchObject({ directions: ['PRESCRIPTION', 'FOLLOW_UP'], followUpDate: followUp, signedAt: null, version: 1 });

      const detail = await consultation(id);
      expect(detail.clinicalNote.treatmentPlan.followUpDate).toBe(followUp);

      // Sửa: bỏ "Hẹn tái khám" (kèm bỏ ngày), thêm "Cấp cứu".
      const edited = await saveNote(
        id,
        baseNote({
          reasonForVisit: { content: 'Ho kéo dài', version: note.reasonForVisit.version },
          preliminaryDiagnosis: { content: 'Viêm phế quản cấp', version: note.preliminaryDiagnosis.version },
          illnessProgress: { content: '', version: note.illnessProgress.version },
          generalExam: { content: '', version: note.generalExam.version },
          regionalExam: { content: '', version: note.regionalExam.version },
          plan: { content: 'Kháng sinh 7 ngày', version: note.plan.version },
          conclusion: { content: 'Kết luận mới', version: note.conclusion.version },
          doctorAdvice: { content: 'Giữ ấm', version: note.doctorAdvice.version },
          treatmentPlan: { directions: ['PRESCRIPTION', 'EMERGENCY'], followUpDate: null, version: note.treatmentPlan.version },
        }),
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(edited.body.data.treatmentPlan).toMatchObject({ directions: ['PRESCRIPTION', 'EMERGENCY'], followUpDate: null, version: 2 });
      expect(edited.body.data.conclusion.content).toBe('Kết luận mới');

      // Lưu lại với version cũ của kế hoạch điều trị → xung đột.
      const stale = await saveNote(
        id,
        baseNote({
          reasonForVisit: { content: 'Ho kéo dài', version: edited.body.data.reasonForVisit.version },
          preliminaryDiagnosis: { content: 'Viêm phế quản cấp', version: edited.body.data.preliminaryDiagnosis.version },
          illnessProgress: { content: '', version: edited.body.data.illnessProgress.version },
          generalExam: { content: '', version: edited.body.data.generalExam.version },
          regionalExam: { content: '', version: edited.body.data.regionalExam.version },
          plan: { content: 'Kháng sinh 7 ngày', version: edited.body.data.plan.version },
          conclusion: { content: 'x', version: edited.body.data.conclusion.version },
          doctorAdvice: { content: 'y', version: edited.body.data.doctorAdvice.version },
          treatmentPlan: { directions: ['PRESCRIPTION'], followUpDate: null, version: 1 },
        }),
      );
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('client cũ không gửi trường mới vẫn lưu được; các trường mới trả null', async () => {
      const id = await prepareEncounter();
      const res = await saveNote(id, baseNote());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.conclusion).toBeNull();
      expect(res.body.data.doctorAdvice).toBeNull();
      expect(res.body.data.treatmentPlan).toBeNull();
    });

    it('ngày hẹn: thiếu ngày khi tích Hẹn tái khám → 400; có ngày mà không tích → 400; trùng hướng → 400', async () => {
      const id = await prepareEncounter();
      const noDate = await saveNote(id, baseNote({ treatmentPlan: { directions: ['FOLLOW_UP'], followUpDate: null } }));
      expect(noDate.status).toBe(400);
      const strayDate = await saveNote(id, baseNote({ treatmentPlan: { directions: ['PRESCRIPTION'], followUpDate: inDays(3) } }));
      expect(strayDate.status).toBe(400);
      const dup = await saveNote(id, baseNote({ treatmentPlan: { directions: ['PRESCRIPTION', 'PRESCRIPTION'], followUpDate: null } }));
      expect(dup.status).toBe(400);
      const badDir = await saveNote(id, baseNote({ treatmentPlan: { directions: ['KHAC'], followUpDate: null } }));
      expect(badDir.status).toBe(400);
    });

    it('ngày hẹn phải SAU ngày khám và không quá 365 ngày → 422 FOLLOW_UP_DATE_INVALID; đúng 1 và đúng 365 ngày thì được', async () => {
      const id = await prepareEncounter();
      for (const bad of [today(), inDays(-3), inDays(366)]) {
        const res = await saveNote(id, baseNote({ treatmentPlan: { directions: ['FOLLOW_UP'], followUpDate: bad } }));
        expect(res.status, bad).toBe(422);
        expect(res.body.error.code).toBe('FOLLOW_UP_DATE_INVALID');
      }
      const one = await saveNote(id, baseNote({ treatmentPlan: { directions: ['FOLLOW_UP'], followUpDate: inDays(1) } }));
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      const max = await saveNote(
        id,
        baseNote({
          reasonForVisit: { content: 'Ho kéo dài', version: one.body.data.reasonForVisit.version },
          preliminaryDiagnosis: { content: 'Viêm phế quản cấp', version: one.body.data.preliminaryDiagnosis.version },
          illnessProgress: { content: '', version: one.body.data.illnessProgress.version },
          generalExam: { content: '', version: one.body.data.generalExam.version },
          regionalExam: { content: '', version: one.body.data.regionalExam.version },
          plan: { content: '', version: one.body.data.plan.version },
          treatmentPlan: { directions: ['FOLLOW_UP'], followUpDate: inDays(365), version: one.body.data.treatmentPlan.version },
        }),
      );
      expect(max.status, JSON.stringify(max.body)).toBe(200);
    });

    it('phân quyền & cách ly: bác sĩ khác (scope personal) và tenant khác → 404; điều dưỡng không có quyền tạo ghi chú → 403', async () => {
      const id = await prepareEncounter();
      const body = baseNote({ treatmentPlan: { directions: ['PRESCRIPTION'], followUpDate: null } });
      expect((await saveNote(id, body, otherDoctorToken)).status).toBe(404);
      expect((await saveNote(id, body, tenantBDoctorToken)).status).toBe(404);
      expect((await saveNote(id, body, nurseToken)).status).toBe(403);
      expect((await http().put(noteUrl(id)).send(body)).status).toBe(401);
    });
  });

  describe('ký khi Hoàn tất khám + đính chính', () => {
    async function savedAndCompleted(extra: SaveBody = {}) {
      const id = await prepareEncounter();
      const saved = await saveNote(
        id,
        baseNote({
          conclusion: { content: 'Kết luận gốc' },
          doctorAdvice: { content: 'Lời dặn gốc' },
          treatmentPlan: { directions: ['PRESCRIPTION', 'FOLLOW_UP'], followUpDate: inDays(7) },
          ...extra,
        }),
      );
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      await complete(id);
      return id;
    }

    it('Hoàn tất khám ký cả 3 mục ghi chú mới lẫn kế hoạch điều trị; lưu lại sau khi ký → 409; DB chặn sửa nội dung đã ký (trigger)', async () => {
      const id = await savedAndCompleted();
      const detail = await consultation(id);
      expect(detail.clinicalNote.conclusion.signedAt).not.toBeNull();
      expect(detail.clinicalNote.doctorAdvice.signedAt).not.toBeNull();
      expect(detail.clinicalNote.treatmentPlan.signedAt).not.toBeNull();

      const again = await saveNote(id, baseNote({ treatmentPlan: { directions: ['PRESCRIPTION'], followUpDate: null } }));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('CLINICAL_RECORD_ALREADY_SIGNED');

      await expect(
        privileged.encounterTreatmentPlan.updateMany({ where: { encounterId: id, deletedAt: null }, data: { followUpDate: new Date(`${inDays(30)}T00:00:00.000Z`) } }),
      ).rejects.toThrow(/đã ký/);
    });

    it('đính chính kế hoạch điều trị: bản mới ký ngay trỏ về bản cũ + lý do; bản cũ soft-delete; không đổi gì thì giữ nguyên bản đã ký', async () => {
      const id = await savedAndCompleted();
      const before = (await consultation(id)).clinicalNote;
      const oldPlan = before.treatmentPlan;

      const amended = await http()
        .post(`${noteUrl(id)}/amend`)
        .set(authed(doctorToken))
        .send({
          amendmentReason: 'Đổi lịch tái khám theo yêu cầu bệnh nhân',
          sections: [{ section: 'DOCTOR_ADVICE', content: 'Lời dặn đã sửa', version: before.doctorAdvice.version }],
          treatmentPlan: { directions: ['PRESCRIPTION', 'FOLLOW_UP'], followUpDate: inDays(14), version: oldPlan.version },
        });
      expect(amended.status, JSON.stringify(amended.body)).toBe(200);
      const after = amended.body.data;
      expect(after.treatmentPlan.followUpDate).toBe(inDays(14));
      expect(after.treatmentPlan.supersedesId).not.toBeNull();
      expect(after.treatmentPlan.amendmentReason).toBe('Đổi lịch tái khám theo yêu cầu bệnh nhân');
      expect(after.treatmentPlan.signedAt).not.toBeNull();
      expect(after.doctorAdvice.content).toBe('Lời dặn đã sửa');
      // Mục không gửi (Kết luận) giữ nguyên bản cũ.
      expect(after.conclusion.version).toBe(before.conclusion.version);

      const rows = await privileged.encounterTreatmentPlan.findMany({ where: { encounterId: id }, orderBy: { createdAt: 'asc' } });
      expect(rows).toHaveLength(2);
      expect(rows[0]!.deletedAt).not.toBeNull();
      expect(rows[0]!.deletedReason).toBe('amended');

      // Gửi lại đúng nội dung hiện tại (chỉ đổi Kết luận) → kế hoạch điều trị KHÔNG tạo bản mới.
      const unchanged = await http()
        .post(`${noteUrl(id)}/amend`)
        .set(authed(doctorToken))
        .send({
          amendmentReason: 'Chỉ sửa kết luận',
          sections: [{ section: 'CONCLUSION', content: 'Kết luận đã sửa', version: after.conclusion.version }],
          treatmentPlan: { directions: ['FOLLOW_UP', 'PRESCRIPTION'], followUpDate: inDays(14), version: after.treatmentPlan.version },
        });
      expect(unchanged.status, JSON.stringify(unchanged.body)).toBe(200);
      expect(unchanged.body.data.treatmentPlan.version).toBe(after.treatmentPlan.version);
      expect(await privileged.encounterTreatmentPlan.count({ where: { encounterId: id } })).toBe(2);

      // Version cũ → 409; thiếu lý do → 400; không có gì để sửa → 400.
      const stale = await http()
        .post(`${noteUrl(id)}/amend`)
        .set(authed(doctorToken))
        .send({ amendmentReason: 'Thử version cũ', treatmentPlan: { directions: ['PRESCRIPTION'], followUpDate: null, version: oldPlan.version } });
      expect(stale.status).toBe(409);
      const noReason = await http().post(`${noteUrl(id)}/amend`).set(authed(doctorToken)).send({ treatmentPlan: { directions: ['PRESCRIPTION'], followUpDate: null, version: after.treatmentPlan.version } });
      expect(noReason.status).toBe(400);
      const nothing = await http().post(`${noteUrl(id)}/amend`).set(authed(doctorToken)).send({ amendmentReason: 'Không sửa gì' });
      expect(nothing.status).toBe(400);
      // Ngày hẹn vẫn phải hợp lệ khi đính chính.
      const badDate = await http()
        .post(`${noteUrl(id)}/amend`)
        .set(authed(doctorToken))
        .send({ amendmentReason: 'Ngày sai', treatmentPlan: { directions: ['FOLLOW_UP'], followUpDate: inDays(-1), version: after.treatmentPlan.version } });
      expect(badDate.status).toBe(422);
    });

    it('lượt khám hoàn tất mà CHƯA có Kết luận/kế hoạch điều trị: đính chính (không kèm version) tạo bản ký mới', async () => {
      const id = await prepareEncounter();
      expect((await saveNote(id, baseNote())).status).toBe(200);
      await complete(id);
      const res = await http()
        .post(`${noteUrl(id)}/amend`)
        .set(authed(doctorToken))
        .send({
          amendmentReason: 'Bổ sung kết luận và hướng điều trị',
          sections: [{ section: 'CONCLUSION', content: 'Kết luận bổ sung' }],
          treatmentPlan: { directions: ['PRESCRIPTION'], followUpDate: null },
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.conclusion).toMatchObject({ content: 'Kết luận bổ sung', supersedesId: null });
      expect(res.body.data.conclusion.signedAt).not.toBeNull();
      expect(res.body.data.treatmentPlan).toMatchObject({ directions: ['PRESCRIPTION'], supersedesId: null });
      expect(res.body.data.treatmentPlan.signedAt).not.toBeNull();
    });

    it('đính chính: bác sĩ khác → 404; tenant khác → 404', async () => {
      const id = await savedAndCompleted();
      const body = { amendmentReason: 'Thử', treatmentPlan: { directions: ['PRESCRIPTION'], followUpDate: null, version: 1 } };
      expect((await http().post(`${noteUrl(id)}/amend`).set(authed(otherDoctorToken)).send(body)).status).toBe(404);
      expect((await http().post(`${noteUrl(id)}/amend`).set(authed(tenantBDoctorToken)).send(body)).status).toBe(404);
    });
  });

  describe('Mẫu lời dặn (/advice-templates)', () => {
    const url = '/api/v1/advice-templates';
    const create = (token: string, body: Record<string, unknown>) => http().post(url).set(authed(token)).send(body);

    it('bác sĩ tạo → danh sách thấy; tên trùng (không phân biệt hoa thường, bỏ khoảng trắng đầu cuối) → 409; sửa kèm version; version cũ → 409', async () => {
      const name = `Viêm đường hô hấp ${randomUUID().slice(0, 6)}`;
      const created = await create(doctorToken, { name, content: 'Giữ ấm, tránh khói bụi.' });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect(created.body.data).toMatchObject({ name, content: 'Giữ ấm, tránh khói bụi.', isActive: true, version: 1 });

      const dup = await create(doctorToken, { name: `  ${name.toUpperCase()}  `, content: 'Nội dung khác' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('ADVICE_TEMPLATE_DUPLICATE_NAME');

      const id = created.body.data.id as string;
      const updated = await http().patch(`${url}/${id}`).set(authed(adminToken)).send({ content: 'Nội dung mới', version: 1 });
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body.data).toMatchObject({ content: 'Nội dung mới', version: 2 });
      const stale = await http().patch(`${url}/${id}`).set(authed(adminToken)).send({ content: 'Cũ', version: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');

      // Đổi tên sang tên đang có → 409.
      const other = await create(doctorToken, { name: `Mẫu khác ${randomUUID().slice(0, 6)}`, content: 'a' });
      const rename = await http().patch(`${url}/${other.body.data.id}`).set(authed(doctorToken)).send({ name, version: 1 });
      expect(rename.status).toBe(409);
    });

    it('ẩn mẫu (isActive=false): danh sách mặc định không thấy, includeInactive=true thấy; kích hoạt lại được; tên của mẫu đã ẩn vẫn bị giữ (không trùng)', async () => {
      const name = `Mẫu để ẩn ${randomUUID().slice(0, 6)}`;
      const created = await create(doctorToken, { name, content: 'Nội dung' });
      const id = created.body.data.id as string;
      const hidden = await http().patch(`${url}/${id}`).set(authed(doctorToken)).send({ isActive: false, version: 1 });
      expect(hidden.status).toBe(200);
      const names = async (query = '') => ((await http().get(`${url}${query}`).set(authed(doctorToken))).body.data.items as { name: string }[]).map((i) => i.name);
      expect(await names()).not.toContain(name);
      expect(await names('?includeInactive=true')).toContain(name);
      expect(await names('?includeInactive=false')).not.toContain(name);
      expect((await create(doctorToken, { name, content: 'Tạo lại cùng tên' })).status).toBe(409);
      const back = await http().patch(`${url}/${id}`).set(authed(doctorToken)).send({ isActive: true, version: 2 });
      expect(back.status).toBe(200);
      expect(await names()).toContain(name);
    });

    it('kiểm tra dữ liệu: tên/nội dung trống hoặc quá dài → 400', async () => {
      expect((await create(doctorToken, { name: '   ', content: 'a' })).status).toBe(400);
      expect((await create(doctorToken, { name: 'a', content: '   ' })).status).toBe(400);
      expect((await create(doctorToken, { name: 'x'.repeat(121), content: 'a' })).status).toBe(400);
      expect((await create(doctorToken, { name: 'ok', content: 'y'.repeat(2001) })).status).toBe(400);
    });

    it('phân quyền: điều dưỡng chỉ xem (tạo/sửa → 403), lễ tân không xem được (403), chưa đăng nhập → 401', async () => {
      const created = await create(adminToken, { name: `Mẫu phân quyền ${randomUUID().slice(0, 6)}`, content: 'a' });
      const id = created.body.data.id as string;
      expect((await http().get(url).set(authed(nurseToken))).status).toBe(200);
      expect((await create(nurseToken, { name: 'x', content: 'y' })).status).toBe(403);
      expect((await http().patch(`${url}/${id}`).set(authed(nurseToken)).send({ content: 'z', version: 1 })).status).toBe(403);
      expect((await http().get(url).set(authed(receptionistToken))).status).toBe(403);
      expect((await http().get(url)).status).toBe(401);
    });

    it('cách ly tenant: tenant B không thấy mẫu của tenant A, không sửa được (404), được dùng cùng tên', async () => {
      const name = `Mẫu cách ly ${randomUUID().slice(0, 6)}`;
      const created = await create(doctorToken, { name, content: 'a' });
      const id = created.body.data.id as string;
      expect(((await http().get(url).set(authed(tenantBAdminToken))).body.data.items as { name: string }[]).map((i) => i.name)).not.toContain(name);
      expect((await http().patch(`${url}/${id}`).set(authed(tenantBAdminToken)).send({ content: 'hack', version: 1 })).status).toBe(404);
      expect((await create(tenantBAdminToken, { name, content: 'b' })).status).toBe(200);
    });
  });
});
