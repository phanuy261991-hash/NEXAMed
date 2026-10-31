import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PDF_RENDERER_PORT, type PdfRendererPort } from '@nexamed/core';
import { buildDefaultPrintTemplateConfig } from '@nexamed/shared';
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
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — Hồ sơ bệnh án điện tử (docs/DECISIONS.md #269): "Số lưu trữ" (trước đây "Số bệnh án", đổi theo mẫu MS 15/BV-01) cấp lúc Hoàn tất khám (theo năm, chung công ty, không thủng số, khuôn đổi được) và hai mục ghi chú tuỳ chọn
 * "Tóm tắt bệnh án"/"Tiên lượng" (lưu cùng ghi chú khám, ký khi Hoàn tất khám, đính chính cùng khuôn Kết luận/Lời dặn).
 */
describe('HTTP e2e — Hồ sơ bệnh án: Số lưu trữ + Tóm tắt/Tình trạng ra viện (#269)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let adminToken: string;
  let receptionistToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let tenantBReceptionistToken: string;
  let tenantBDoctorToken: string;
  let tenantBDoctorUserId: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const randomNationalId = (): string => '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  const noteUrl = (id: string) => `/api/v1/encounters/${id}/clinical-note`;
  const year = () => String(new Date().getFullYear());

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-mr-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  /** Tiếp nhận (thu tiền ngay) + bắt đầu khám; trả về id lượt khám và id bệnh nhân. */
  async function prepareEncounter(receptionist = receptionistToken, doctor = doctorToken, doctorId = doctorUserId, patientId?: string): Promise<{ id: string; patientId: string }> {
    let pid = patientId;
    if (!pid) {
      const patientRes = await http()
        .post('/api/v1/patients')
        .set(authed(receptionist))
        .send({ fullName: 'Bệnh nhân e2e bệnh án', dob: '1988-03-04', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
      expect(patientRes.status, JSON.stringify(patientRes.body)).toBe(200);
      pid = patientRes.body.data.id as string;
    }
    const checkIn = await http()
      .post('/api/v1/reception/direct')
      .set(authed(receptionist))
      .send({
        patientId: pid,
        doctorId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
        checkedInAt: new Date().toISOString(),
      });
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
    const id = checkIn.body.data.id as string;
    await http().post(`/api/v1/billing/invoices/${id}/pay`).set(authed(receptionist)).send({ method: 'CASH', version: 1 });
    const start = await http().post(`/api/v1/encounters/${id}/start`).set(authed(doctor)).send({ version: 1 });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    return { id, patientId: pid };
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
    return res.body.data as {
      encounter: { version: number; archiveNo: string | null; encounterNo: string };
      clinicalNote: Record<'summary' | 'prognosis', { version: number; signedAt: string | null; content: string } | null>;
    };
  };
  async function addPrimaryDiagnosis(encounterId: string, token = doctorToken) {
    const dx = await http().put(`/api/v1/encounters/${encounterId}/diagnoses`).set(authed(token)).send({ diagnoses: [{ icd10Code: 'A00.0', type: 'PRIMARY' }] });
    expect(dx.status, JSON.stringify(dx.body)).toBe(200);
  }
  async function complete(encounterId: string, token = doctorToken) {
    await addPrimaryDiagnosis(encounterId, token);
    const detail = await consultation(encounterId, token);
    const done = await http().post(`/api/v1/encounters/${encounterId}/complete`).set(authed(token)).send({ version: detail.encounter.version });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return done.body.data as { archiveNo: string | null };
  }
  const recordSequence = (n: string) => Number(n.split('-')[1]);

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

    fixture = await createTwoTenantFixture(privileged, 'MedicalRecord e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    adminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;
    tenantBReceptionistToken = (await createUserWithRole(fixture.tenantB.id, 'receptionist')).token;
    const doctorB = await createUserWithRole(fixture.tenantB.id, 'doctor');
    tenantBDoctorToken = doctorB.token;
    tenantBDoctorUserId = doctorB.userId;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('Tóm tắt bệnh án + Tiên lượng', () => {
    it('lưu cùng ghi chú khám, đọc lại đúng, sửa kèm version; client cũ không gửi thì trả null; version cũ → 409', async () => {
      const old = await prepareEncounter();
      const oldRes = await saveNote(old.id, baseNote());
      expect(oldRes.status, JSON.stringify(oldRes.body)).toBe(200);
      expect(oldRes.body.data.summary).toBeNull();
      expect(oldRes.body.data.prognosis).toBeNull();

      const { id } = await prepareEncounter();
      const saved = await saveNote(id, baseNote({ summary: { content: 'Nữ 38 tuổi, ho sốt 3 ngày, X-quang bình thường.' }, prognosis: { content: 'Tiên lượng tốt.' } }));
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body.data.summary).toMatchObject({ content: 'Nữ 38 tuổi, ho sốt 3 ngày, X-quang bình thường.', version: 1, signedAt: null });
      expect(saved.body.data.prognosis).toMatchObject({ content: 'Tiên lượng tốt.', version: 1, signedAt: null });

      const detail = await consultation(id);
      expect(detail.clinicalNote.summary?.content).toBe('Nữ 38 tuổi, ho sốt 3 ngày, X-quang bình thường.');

      const note = saved.body.data;
      const edit = (summaryVersion: number | undefined) =>
        saveNote(
          id,
          baseNote({
            reasonForVisit: { content: 'Ho kéo dài', version: note.reasonForVisit.version },
            illnessProgress: { content: '', version: note.illnessProgress.version },
            preliminaryDiagnosis: { content: 'Viêm phế quản cấp', version: note.preliminaryDiagnosis.version },
            generalExam: { content: '', version: note.generalExam.version },
            regionalExam: { content: '', version: note.regionalExam.version },
            plan: { content: '', version: note.plan.version },
            summary: { content: 'Tóm tắt đã sửa', version: summaryVersion },
            prognosis: { content: 'Tiên lượng tốt.', version: note.prognosis.version },
          }),
        );
      const ok = await edit(note.summary.version);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.summary).toMatchObject({ content: 'Tóm tắt đã sửa', version: 2 });
      // Gửi lại version cũ (1) → xung đột khoá lạc quan.
      const stale = await edit(1);
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('KHÔNG bắt buộc: hoàn tất khám được khi không ghi Tóm tắt/Tiên lượng', async () => {
      const { id } = await prepareEncounter();
      await saveNote(id, baseNote());
      await expect(complete(id)).resolves.toBeDefined();
    });

    it('ký khi Hoàn tất khám; sửa sau khi ký phải đính chính (409 nếu sửa thẳng); đính chính thêm mục chưa từng ghi tạo bản ký mới', async () => {
      const { id } = await prepareEncounter();
      // Chỉ ghi Tóm tắt; Tiên lượng để trống để thử đính chính "mục chưa từng có dòng".
      await saveNote(id, baseNote({ summary: { content: 'Tóm tắt gốc' } }));
      await complete(id);

      const signed = await consultation(id);
      expect(signed.clinicalNote.summary?.signedAt).not.toBeNull();
      expect(signed.clinicalNote.prognosis).toBeNull();

      const direct = await saveNote(id, baseNote({ summary: { content: 'sửa lén', version: signed.clinicalNote.summary?.version } }));
      expect(direct.status).toBe(409);
      expect(direct.body.error.code).toBe('CLINICAL_RECORD_ALREADY_SIGNED');

      const amended = await http()
        .post(`${noteUrl(id)}/amend`)
        .set(authed(doctorToken))
        .send({
          amendmentReason: 'Bổ sung tiên lượng và chỉnh tóm tắt',
          sections: [
            { section: 'SUMMARY', content: 'Tóm tắt đã đính chính', version: signed.clinicalNote.summary?.version },
            { section: 'PROGNOSIS', content: 'Tiên lượng tốt, hồi phục sau 5–7 ngày' },
          ],
        });
      expect(amended.status, JSON.stringify(amended.body)).toBe(200);
      expect(amended.body.data.summary).toMatchObject({ content: 'Tóm tắt đã đính chính', amendmentReason: 'Bổ sung tiên lượng và chỉnh tóm tắt' });
      expect(amended.body.data.summary.signedAt).not.toBeNull();
      expect(amended.body.data.prognosis).toMatchObject({ content: 'Tiên lượng tốt, hồi phục sau 5–7 ngày', amendmentReason: 'Bổ sung tiên lượng và chỉnh tóm tắt' });
      expect(amended.body.data.prognosis.signedAt).not.toBeNull();
    });
  });

  describe('Số lưu trữ', () => {
    it('chưa có khi chưa hoàn tất; cấp lúc Hoàn tất khám theo khuôn mặc định LT<năm>-<6 số>; hiện ở chi tiết lượt khám và danh sách lịch sử', async () => {
      const { id, patientId } = await prepareEncounter();
      expect((await consultation(id)).encounter.archiveNo).toBeNull();

      const done = await complete(id);
      expect(done.archiveNo).toMatch(new RegExp(`^LT${year()}-\\d{6}$`));
      const detail = await consultation(id);
      expect(detail.encounter.archiveNo).toBe(done.archiveNo);
      // Tách biệt với mã lượt khám.
      expect(detail.encounter.archiveNo).not.toBe(detail.encounter.encounterNo);

      const history = await http().get(`/api/v1/encounters/by-patient/${patientId}/history`).set(authed(doctorToken));
      expect(history.status, JSON.stringify(history.body)).toBe(200);
      expect(history.body.data.items.find((i: { encounterId: string }) => i.encounterId === id).archiveNo).toBe(done.archiveNo);
    });

    it('lượt khám chưa hoàn tất trong danh sách lịch sử có archiveNo = null', async () => {
      const { id, patientId } = await prepareEncounter();
      // Mặc định danh sách chỉ lấy lượt đã hoàn tất — xin `status=ALL` để thấy cả lượt đang khám.
      const history = await http().get(`/api/v1/encounters/by-patient/${patientId}/history?status=ALL`).set(authed(doctorToken));
      expect(history.status, JSON.stringify(history.body)).toBe(200);
      expect(history.body.data.items.find((i: { encounterId: string }) => i.encounterId === id).archiveNo).toBeNull();
    });

    it('tăng liên tục, không trùng; hoàn tất thất bại (khoá lạc quan) KHÔNG làm thủng số', async () => {
      const a = await prepareEncounter();
      const b = await prepareEncounter();
      const c = await prepareEncounter();
      const doneA = await complete(a.id);

      // Hoàn tất B với version cũ → 409; số đã cấp trong transaction đó phải rollback theo.
      await addPrimaryDiagnosis(b.id);
      const detailB = await consultation(b.id);
      const stale = await http().post(`/api/v1/encounters/${b.id}/complete`).set(authed(doctorToken)).send({ version: detailB.encounter.version + 5 });
      expect(stale.status).toBe(409);
      expect((await consultation(b.id)).encounter.archiveNo).toBeNull();

      const doneC = await complete(c.id);
      expect(recordSequence(doneC.archiveNo!)).toBe(recordSequence(doneA.archiveNo!) + 1);
      const doneB = await complete(b.id);
      expect(recordSequence(doneB.archiveNo!)).toBe(recordSequence(doneC.archiveNo!) + 1);
    });

    it('hai bác sĩ hoàn tất ĐỒNG THỜI không bao giờ trùng số', async () => {
      const [x, y] = [await prepareEncounter(), await prepareEncounter()];
      await Promise.all([addPrimaryDiagnosis(x.id), addPrimaryDiagnosis(y.id)]);
      const [dx, dy] = [await consultation(x.id), await consultation(y.id)];
      const [rx, ry] = await Promise.all([
        http().post(`/api/v1/encounters/${x.id}/complete`).set(authed(doctorToken)).send({ version: dx.encounter.version }),
        http().post(`/api/v1/encounters/${y.id}/complete`).set(authed(doctorToken)).send({ version: dy.encounter.version }),
      ]);
      expect([rx.status, ry.status]).toEqual([200, 200]);
      expect(rx.body.data.archiveNo).not.toBe(ry.body.data.archiveNo);
    });

    it('khuôn đổi được ở "Cấu hình mẫu mã phát sinh" và áp cho lượt hoàn tất kế tiếp', async () => {
      const list = await http().get('/api/v1/clinic-settings/code-templates').set(authed(adminToken));
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      const entry = list.body.data.items.find((i: { codeType: string }) => i.codeType === 'ARCHIVE_NO');
      expect(entry).toBeDefined();
      expect(entry.label).toBe('Số lưu trữ');
      expect(entry.template).toBe('LT[Năm 4 số]-[Số đếm]');

      const patched = await http()
        .patch('/api/v1/clinic-settings/code-templates/ARCHIVE_NO')
        .set(authed(adminToken))
        .send({ template: 'HS[Năm 2 số]/[Số đếm]', counterDigits: 5 });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);

      const { id } = await prepareEncounter();
      const done = await complete(id);
      expect(done.archiveNo).toMatch(/^HS\d{2}\/\d{5}$/);
    });

    it('cô lập công ty: bộ đếm công ty B độc lập, và công ty B không đọc được lượt khám/Số lưu trữ của công ty A', async () => {
      const a = await prepareEncounter();
      const doneA = await complete(a.id);
      expect(doneA.archiveNo).toBeTruthy();

      const leak = await http().get(`/api/v1/encounters/${a.id}/consultation`).set(authed(tenantBDoctorToken));
      expect(leak.status).toBe(404);

      const b = await prepareEncounter(tenantBReceptionistToken, tenantBDoctorToken, tenantBDoctorUserId);
      const doneB = await complete(b.id, tenantBDoctorToken);
      // Công ty B chưa từng cấp số nào → bắt đầu từ 1, không bị ảnh hưởng bởi bộ đếm công ty A.
      expect(doneB.archiveNo).toMatch(new RegExp(`^LT${year()}-000001$`));

      const dbRows = await privileged.encounter.findMany({ where: { id: { in: [a.id, b.id] } }, select: { id: true, tenantId: true, archiveNo: true } });
      expect(dbRows.find((r) => r.id === b.id)?.tenantId).toBe(fixture.tenantB.id);
    });

    it('ràng buộc DB: hai lượt khám cùng công ty không thể mang cùng một Số lưu trữ', async () => {
      const a = await prepareEncounter();
      const b = await prepareEncounter();
      const doneA = await complete(a.id);
      await expect(privileged.$executeRaw`UPDATE encounter SET archive_no = ${doneA.archiveNo} WHERE id = ${b.id}::uuid`).rejects.toThrow(/23505|already exists/i);
    });
  });

  describe('POST /encounters/:id/medical-record/export — "In bộ hồ sơ" một lượt khám', () => {
    // Làm nóng Chromium một lần (khởi động nguội trên máy CI từng vượt 30 giây của test đầu tiên — cùng lý do spec xuất bệnh án PDF ở encounter-http.spec.ts).
    beforeAll(async () => {
      await app.get<PdfRendererPort>(PDF_RENDERER_PORT).renderHtmlToPdf('<html><body>warm-up</body></html>');
    }, 120_000);

    const exportUrl = (id: string) => `/api/v1/encounters/${id}/medical-record/export`;
    /** Bắt chuỗi HTML đưa vào cổng dựng PDF (vẫn gọi thật để có PDF) — kiểm NỘI DUNG bộ hồ sơ, không chỉ mã trạng thái. */
    function captureHtml(): { html: () => string; restore: () => void } {
      const renderer = app.get<PdfRendererPort>(PDF_RENDERER_PORT);
      const spy = vi.spyOn(renderer, 'renderHtmlToPdf');
      return { html: () => String(spy.mock.calls.at(-1)?.[0] ?? ''), restore: () => spy.mockRestore() };
    }

    it('bác sĩ in được → 200, PDF thật, tên tệp theo Số lưu trữ, ghi nhật ký kèm lý do + bệnh nhân; nội dung theo khung MS 15/BV-01 (I–IV + Tổng kết)', async () => {
      const rt = await privileged.referenceCatalog.findFirst({ where: { tenantId: fixture.tenantA.id, category: 'RECEPTION_TYPE', code: 'RT_NEW' } });
      if (!rt) await privileged.referenceCatalog.create({ data: { tenantId: fixture.tenantA.id, category: 'RECEPTION_TYPE', code: 'RT_NEW', name: 'Khám mới', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      const { id, patientId } = await prepareEncounter();
      await saveNote(id, baseNote({ summary: { content: 'Tóm tắt dành cho bộ hồ sơ' }, prognosis: { content: 'Tiên lượng dành cho bộ hồ sơ' }, doctorAdvice: { content: 'Uống nhiều nước ấm' } }));
      const done = await complete(id);
      const capture = captureHtml();
      try {
        const res = await http().post(exportUrl(id)).set(authed(doctorToken)).send({ reason: 'Giao hồ sơ cho bệnh nhân' });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        // Tên tệp chỉ giữ chữ, số, `.`, `_`, `-` (khuôn Số lưu trữ do phòng khám tự cấu hình có thể chứa `/`).
        expect(res.headers['content-disposition']).toContain(`ho-so-benh-an-${done.archiveNo!.replace(/[^A-Za-z0-9._-]/g, '')}.pdf`);
        expect(Buffer.from(res.body).subarray(0, 4).toString()).toBe('%PDF');

        const html = capture.html();
        for (const numeral of ['I', 'II', 'III', 'IV', '1', '2', '3', '4', '5', '6']) expect(html).toContain(`<span class="rec-num">${numeral}</span>`);
        expect(html).toContain('MS: 15/BV-01');
        expect(html).toContain('Tổng kết bệnh án');
        expect(html).toContain('Khám mới'); // nhãn Loại tiếp nhận (RT_NEW) của lượt khám
        expect(html).not.toContain('Số bệnh án');
        for (const s of [done.archiveNo!, 'Bệnh nhân e2e bệnh án', 'Tóm tắt dành cho bộ hồ sơ', 'Tiên lượng dành cho bộ hồ sơ', 'Uống nhiều nước ấm', 'Viêm phế quản cấp', 'Giao hồ sơ cho bệnh nhân']) expect(html).toContain(s);
        expect(html).not.toMatch(/đồng|₫|Thành tiền|Đã thu|Chưa thu/);
      } finally {
        capture.restore();
      }

      const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'encounter.medical_record_exported', entityId: id }, orderBy: { occurredAt: 'desc' } });
      expect(audit).not.toBeNull();
      expect(audit?.afterJson).toMatchObject({ reason: 'Giao hồ sơ cho bệnh nhân', patientId });
      // Nhật ký không ghi nội dung lâm sàng.
      expect(JSON.stringify(audit?.afterJson)).not.toContain('Tóm tắt dành cho bộ hồ sơ');
    });

    it('giờ in theo giờ Việt Nam và có đúng tên đầu phiếu của phòng khám', async () => {
      const { id } = await prepareEncounter();
      await saveNote(id, baseNote());
      await complete(id);
      const row = await privileged.encounter.findUniqueOrThrow({ where: { id }, select: { checkedInAt: true } });
      const vn = new Date(row.checkedInAt.getTime() + 7 * 3_600_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const expected = `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`;
      const capture = captureHtml();
      try {
        expect((await http().post(exportUrl(id)).set(authed(doctorToken)).send({ reason: 'Kiểm giờ' })).status).toBe(200);
        expect(capture.html()).toContain(expected);
      } finally {
        capture.restore();
      }
    });

    it('đơn thuốc ĐÃ KÝ trong bộ hồ sơ: in TÊN đơn vị tính ("viên") chứ không in mã thô ("VIEN"); đơn chưa ký không có mặt', async () => {
      const unit = await privileged.referenceCatalog.findFirst({ where: { tenantId: fixture.tenantA.id, category: 'UNIT', code: 'VIEN' } });
      if (!unit) await privileged.referenceCatalog.create({ data: { tenantId: fixture.tenantA.id, category: 'UNIT', code: 'VIEN', name: 'viên', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      const drug = await privileged.drug.create({
        data: { tenantId: fixture.tenantA.id, code: `DRG-${randomUUID().slice(0, 8)}`, name: 'Thuốc thử bộ hồ sơ', baseUnitCode: 'VIEN', activeIngredient: 'Hoạt chất thử', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
      const { id } = await prepareEncounter();
      await saveNote(id, baseNote());
      await addPrimaryDiagnosis(id);
      const saved = await http().put(`/api/v1/encounters/${id}/prescription-items`).set(authed(doctorToken)).send({ items: [{ drugId: drug.id, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 1, durationDays: 7 }] });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      await complete(id);
      const capture = captureHtml();
      try {
        // Đơn chưa ký → bộ hồ sơ không có đơn thuốc.
        expect((await http().post(exportUrl(id)).set(authed(doctorToken)).send({ reason: 'Đơn chưa ký' })).status).toBe(200);
        expect(capture.html()).not.toContain('Thuốc thử bộ hồ sơ');
      } finally {
        capture.restore();
      }

      const sameEncounter = await prepareEncounter();
      await saveNote(sameEncounter.id, baseNote());
      await addPrimaryDiagnosis(sameEncounter.id);
      const saved2 = await http().put(`/api/v1/encounters/${sameEncounter.id}/prescription-items`).set(authed(doctorToken)).send({ items: [{ drugId: drug.id, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 1, durationDays: 7 }] });
      expect(saved2.status, JSON.stringify(saved2.body)).toBe(200);
      const signed = await http().post(`/api/v1/encounters/${sameEncounter.id}/prescription/sign`).set(authed(doctorToken)).send({ version: saved2.body.data.version });
      expect(signed.status, JSON.stringify(signed.body)).toBe(200);
      await complete(sameEncounter.id);
      const capture2 = captureHtml();
      try {
        expect((await http().post(exportUrl(sameEncounter.id)).set(authed(doctorToken)).send({ reason: 'Đơn đã ký' })).status).toBe(200);
        const html = capture2.html();
        expect(html).toContain('Thuốc thử bộ hồ sơ');
        expect(html).toContain('14 viên');
        expect(html).not.toContain('14 VIEN');
      } finally {
        capture2.restore();
      }
    });

    it('bản mẫu in Bệnh án tắt "Đơn thuốc" (#272): PDF không còn trang đơn thuốc dù đã ký, thuốc vẫn ở mục "Đã xử lý" của tờ khám; bật lại thì trang đơn quay lại', async () => {
      const unit = await privileged.referenceCatalog.findFirst({ where: { tenantId: fixture.tenantA.id, category: 'UNIT', code: 'VIEN' } });
      if (!unit) await privileged.referenceCatalog.create({ data: { tenantId: fixture.tenantA.id, category: 'UNIT', code: 'VIEN', name: 'viên', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      const drug = await privileged.drug.create({
        data: { tenantId: fixture.tenantA.id, code: `DRG-${randomUUID().slice(0, 8)}`, name: 'Thuốc thử bản mẫu bộ hồ sơ', baseUnitCode: 'VIEN', activeIngredient: 'Hoạt chất thử', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
      const { id } = await prepareEncounter();
      await saveNote(id, baseNote());
      await addPrimaryDiagnosis(id);
      const saved = await http().put(`/api/v1/encounters/${id}/prescription-items`).set(authed(doctorToken)).send({ items: [{ drugId: drug.id, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 1, durationDays: 7 }] });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const signed = await http().post(`/api/v1/encounters/${id}/prescription/sign`).set(authed(doctorToken)).send({ version: saved.body.data.version });
      expect(signed.status, JSON.stringify(signed.body)).toBe(200);
      await complete(id);

      const setBundle = async (bundle: { includeParaclinical: boolean; includePrescriptions: boolean }) => {
        await privileged.printTemplate.deleteMany({ where: { tenantId: fixture.tenantA.id, documentType: 'MEDICAL_RECORD' } });
        await privileged.printTemplate.create({
          data: {
            tenantId: fixture.tenantA.id,
            documentType: 'MEDICAL_RECORD',
            paperSize: 'A4',
            name: 'Bệnh án A4',
            isDefault: true,
            configJson: { ...buildDefaultPrintTemplateConfig('A4'), recordBundle: bundle },
            createdBy: SYSTEM_TEST_ACTOR,
            updatedBy: SYSTEM_TEST_ACTOR,
          },
        });
      };
      const exportHtml = async (reason: string): Promise<string> => {
        const capture = captureHtml();
        try {
          expect((await http().post(exportUrl(id)).set(authed(doctorToken)).send({ reason })).status).toBe(200);
          return capture.html();
        } finally {
          capture.restore();
        }
      };

      try {
        await setBundle({ includeParaclinical: true, includePrescriptions: false });
        const off = await exportHtml('Tắt đơn thuốc');
        expect(off).not.toContain('Đơn thuốc</div>');
        expect(off).toContain('Thuốc thử bản mẫu bộ hồ sơ'); // vẫn là nội dung mục "Đã xử lý" của tờ khám
        expect(off).toContain('Tổng kết bệnh án');

        await setBundle({ includeParaclinical: true, includePrescriptions: true });
        const on = await exportHtml('Bật đơn thuốc');
        expect(on).toContain('Đơn thuốc</div>');
        expect(on).toContain('14 viên');
      } finally {
        await privileged.printTemplate.deleteMany({ where: { tenantId: fixture.tenantA.id, documentType: 'MEDICAL_RECORD' } });
      }
    });

    it('thiếu lý do → 400; lý do toàn khoảng trắng → 400', async () => {
      const { id } = await prepareEncounter();
      await saveNote(id, baseNote());
      await complete(id);
      expect((await http().post(exportUrl(id)).set(authed(doctorToken)).send({})).status).toBe(400);
      expect((await http().post(exportUrl(id)).set(authed(doctorToken)).send({ reason: '   ' })).status).toBe(400);
    });

    it('lượt khám CHƯA hoàn tất → 409 ENCOUNTER_NOT_COMPLETED, không dựng PDF', async () => {
      const { id } = await prepareEncounter();
      const capture = captureHtml();
      try {
        const res = await http().post(exportUrl(id)).set(authed(doctorToken)).send({ reason: 'Thử khi đang khám' });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('ENCOUNTER_NOT_COMPLETED');
        expect(capture.html()).toBe('');
      } finally {
        capture.restore();
      }
    });

    it('lễ tân (không có patient.export_medical_record) → 403; công ty khác → 404; id không tồn tại → 404; id sai định dạng → 400', async () => {
      const { id } = await prepareEncounter();
      await saveNote(id, baseNote());
      await complete(id);
      expect((await http().post(exportUrl(id)).set(authed(receptionistToken)).send({ reason: 'Thử quyền' })).status).toBe(403);
      expect((await http().post(exportUrl(id)).set(authed(tenantBDoctorToken)).send({ reason: 'Thử cách ly' })).status).toBe(404);
      expect((await http().post(exportUrl(randomUUID())).set(authed(doctorToken)).send({ reason: 'Không tồn tại' })).status).toBe(404);
      expect((await http().post(exportUrl('khong-phai-uuid')).set(authed(doctorToken)).send({ reason: 'Sai định dạng' })).status).toBe(400);
    });
  });
});
