/* eslint-disable @typescript-eslint/no-explicit-any -- thân phản hồi e2e không có kiểu, cùng cách các spec HTTP khác */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';
import { PrescriptionSubmissionService } from './prescription-submission.service';

/**
 * HTTP e2e — Liên thông đơn thuốc: ô bổ sung 8b + dải kiểm 8a + hàng chờ gửi 8c + bộ gửi nền (docs/DECISIONS.md #242 GĐ3, bổ sung 17). Cổng là MÁY CHỦ GIẢ cục bộ ghi lại từng yêu cầu thật.
 * Kiểm: xếp hàng khi ký (chỉ khi bật liên thông), ô 8b (lưu/khoá/ghi nhật ký/người giám hộ), gửi thành công/bị từ chối/mất kết nối/401, dữ liệu chưa đủ, đính chính, bộ gửi nền, cô lập chi nhánh + công ty.
 */
interface Call {
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, any>;
}

describe('HTTP e2e — Liên thông đơn thuốc: ô bổ sung, hàng chờ gửi, bộ gửi nền (#242 GĐ3)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchA: string;
  let branchB: string;
  let adminToken: string;
  let receptionistToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let doctorBToken: string;
  let doctorBUserId: string;
  let doctorTenantBToken: string;
  let unitCode: string;
  let hourSeed = 1;
  let submissionService: PrescriptionSubmissionService;

  // ---- cổng giả ----
  let gateway: Server;
  let gatewayUrl: string;
  let calls: Call[] = [];
  let doctorLoginCount = 0;
  type Reply = (res: ServerResponse, call: Call) => void;
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json;charset=UTF-8');
    res.end(JSON.stringify(body));
  };
  let routes: Record<string, Reply> = {};
  const defaultRoutes = (): Record<string, Reply> => ({
    '/api/auth/dang-nhap-co-so-kham-chua-benh': (res) => reply(res, 200, { token: 'FAC-TOKEN', token_type: 'bearer' }),
    '/api/v1/them-bac-si': (res) => reply(res, 200, { success: 'Bạn đã thêm bác sĩ thành công' }),
    '/api/auth/dang-nhap-bac-si': (res) => reply(res, 200, { token: `DOC-TOKEN-${++doctorLoginCount}`, token_type: 'bearer' }),
    '/api/v1/gui-don-thuoc': (res) => reply(res, 200, { success: 'Đã nhận đơn thuốc' }),
  });
  const submitCalls = () => calls.filter((c) => c.path === '/api/v1/gui-don-thuoc');

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(tenantId: string, roleName: string, label: string, branchId?: string) {
    const username = `e2e-isub-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    if (branchId) await privileged.userBranch.create({ data: { tenantId, userId: user.id, branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const res = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { id: user.id as string, token: res.body.data.accessToken as string };
  }

  const patchSettings = (body: Record<string, unknown>) => http().patch('/api/v1/prescription-interop/settings').set(authed(adminToken)).send(body);
  const todayVn = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  async function createDrug(name: string, opts: { controlType?: 'NORMAL' | 'NARCOTIC'; nationalCode?: string | null } = {}) {
    const drug = await privileged.drug.create({
      data: {
        tenantId: fixture.tenantA.id,
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name,
        activeIngredient: `${name} (hoạt chất)`,
        controlType: opts.controlType ?? 'NORMAL',
        baseUnitCode: unitCode,
        nationalCode: opts.nationalCode === undefined ? randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase() : opts.nationalCode,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return { id: drug.id as string, nationalCode: drug.nationalCode as string | null };
  }

  /** Lượt khám đang khám có chẩn đoán chính; bệnh nhân có địa chỉ. `dob` đổi được để thử người giám hộ. */
  async function prepareEncounter(dob = '1990-01-01'): Promise<{ encounterId: string; patientId: string }> {
    const hour = hourSeed++;
    const appointmentRes = await http()
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId: doctorUserId, fullName: 'Khách e2e hàng chờ', phone: '0911222444', scheduledAt: new Date(Date.UTC(2026, 7, 28, hour, 0, 0)).toISOString(), source: 'phone' as const });
    expect(appointmentRes.status, JSON.stringify(appointmentRes.body)).toBe(200);
    const appointment = appointmentRes.body.data as { id: string; version: number };
    const nationalId = '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
    const patientRes = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e hàng chờ', dob, gender: 'female', phone: '0933555666', nationalId, address: { street: '12 Trần Thái Tông' } });
    expect(patientRes.status, JSON.stringify(patientRes.body)).toBe(200);
    const patientId = (patientRes.body.data as { id: string }).id;
    const checkIn = await http()
      .post('/api/v1/reception/check-in')
      .set(authed(receptionistToken))
      .send({
        appointmentId: appointment.id,
        patientId,
        version: appointment.version,
        doctorId: doctorUserId,
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
    const encounterId = checkIn.body.data.id as string;
    await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
    await http().post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    await http().put(`/api/v1/encounters/${encounterId}/diagnoses`).set(authed(doctorToken)).send({ diagnoses: [{ icd10Code: 'A00', type: 'PRIMARY' as const }] });
    return { encounterId, patientId };
  }

  interface PrescriptionBody {
    id: string;
    version: number;
    documents: { id: string; kind: string; nationalCode: string }[];
  }
  const toItems = (drugIds: string[]) => drugIds.map((drugId) => ({ drugId, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 1, durationDays: 3 }));

  async function saveDraft(encounterId: string, drugIds: string[]): Promise<PrescriptionBody> {
    const res = await http().put(`/api/v1/encounters/${encounterId}/prescription-items`).set(authed(doctorToken)).send({ items: toItems(drugIds) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as PrescriptionBody;
  }
  async function sign(encounterId: string, version: number): Promise<PrescriptionBody> {
    const res = await http().post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorToken)).send({ version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as PrescriptionBody;
  }
  async function amend(encounterId: string, version: number, drugIds: string[]): Promise<PrescriptionBody> {
    const res = await http().post(`/api/v1/encounters/${encounterId}/prescription/amend`).set(authed(doctorToken)).send({ version, amendmentReason: 'Điều chỉnh liều theo kết quả khám', items: toItems(drugIds) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as PrescriptionBody;
  }
  const infoOf = (encounterId: string, token = doctorToken) => http().get(`/api/v1/encounters/${encounterId}/prescription-interop`).set(authed(token));
  const putInfo = (encounterId: string, body: Record<string, unknown>, token = doctorToken) => http().put(`/api/v1/encounters/${encounterId}/prescription-interop`).set(authed(token)).send(body);
  const emptyKind = { treatmentFormCode: null, dosePeriodNumber: null, doseFrom: null, doseTo: null, herbalDoses: null, herbalInstruction: null };
  const listRows = async (token = doctorToken, query = '') => (await http().get(`/api/v1/prescription-interop/submissions${query}`).set(authed(token))).body.data;
  const sendRow = (id: string, token = doctorToken) => http().post(`/api/v1/prescription-interop/submissions/${id}/send`).set(authed(token));
  const retryRow = (id: string, token = doctorToken) => http().post(`/api/v1/prescription-interop/submissions/${id}/retry`).set(authed(token));
  const dbRow = (nationalCode: string) => privileged.prescriptionSubmission.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, nationalCode } });

  async function setStandardMode(on: boolean) {
    const res = await http()
      .patch('/api/v1/clinic-settings/code-templates/PRESCRIPTION')
      .set(authed(adminToken))
      .send({ template: 'DT[Năm 2 số][Tháng][Số đếm]', counterDigits: 6, mode: on ? 'STANDARD' : 'CUSTOM' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  /** Lượt khám đã ký đơn C (đủ dữ liệu sau khi điền hình thức điều trị). Trả mã đơn C. */
  async function signedC(opts: { withTreatmentForm: boolean } = { withTreatmentForm: true }) {
    const { encounterId } = await prepareEncounter();
    const drug = await createDrug('Thuốc C');
    const draft = await saveDraft(encounterId, [drug.id]);
    if (opts.withTreatmentForm) expect((await putInfo(encounterId, { kinds: [{ kind: 'C', ...emptyKind, treatmentFormCode: '1' }] })).status).toBe(200);
    const signed = await sign(encounterId, draft.version);
    const doc = signed.documents.find((d) => d.kind === 'C')!;
    return { encounterId, nationalCode: doc.nationalCode, row: await dbRow(doc.nationalCode), drug, signed };
  }

  beforeAll(async () => {
    gateway = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: Record<string, any> = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          body = {};
        }
        const call: Call = { path: req.url ?? '', headers: req.headers, body };
        calls.push(call);
        const handler = routes[call.path];
        if (handler) handler(res, call);
        else reply(res, 404, { message: 'Not Found' });
      });
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    submissionService = app.get(PrescriptionSubmissionService);

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();

    fixture = await createTwoTenantFixture(privileged, 'PrescriptionSubmission e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);
    await privileged.branch.update({ where: { id: branchA }, data: { facilityCode: '79001' } });

    adminToken = (await createUser(fixture.tenantA.id, 'clinic_admin', 'admin')).token;
    const created = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'Chi nhánh Quận 7', address: '88 Nguyễn Thị Thập', phone: '0283777556' });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    branchB = created.body.data.id;
    // Chế độ Chuẩn Bộ Y tế chỉ bật được khi MỌI chi nhánh có mã cơ sở KCB.
    await privileged.branch.update({ where: { id: branchB }, data: { facilityCode: '79002' } });

    receptionistToken = (await createUser(fixture.tenantA.id, 'receptionist', 'reception', branchA)).token;
    const doctor = await createUser(fixture.tenantA.id, 'doctor', 'doctorA', branchA);
    doctorToken = doctor.token;
    doctorUserId = doctor.id;
    const doctorB = await createUser(fixture.tenantA.id, 'doctor', 'doctorB', branchB);
    doctorBToken = doctorB.token;
    doctorBUserId = doctorB.id;
    doctorTenantBToken = (await createUser(fixture.tenantB.id, 'doctor', 'doctorTenantB')).token;

    // Đơn vị tính + cho phép kê tự do không cần ở đây; thuốc cần đơn vị tính để gói gửi hợp lệ.
    const unit = await http().post('/api/v1/reference-catalog').set(authed(adminToken)).send({ category: 'UNIT', name: 'Viên', sortOrder: 0 });
    expect(unit.status, JSON.stringify(unit.body)).toBe(200);
    unitCode = unit.body.data.code;

    await setStandardMode(true);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
  });

  beforeEach(() => {
    calls = [];
    routes = defaultRoutes();
  });

  // ------------------------------------------------------------------ danh mục Hình thức điều trị
  it('danh mục Hình thức điều trị: mã phải là SỐ, bắt buộc nhập tay, trùng mã bị chặn', async () => {
    const post = (body: Record<string, unknown>) => http().post('/api/v1/reference-catalog').set(authed(adminToken)).send({ category: 'TREATMENT_FORM', sortOrder: 0, ...body });
    const letters = await post({ code: 'abc', name: 'Sai định dạng' });
    expect(letters.status).toBe(422);
    expect(letters.body.error.code).toBe('REFERENCE_CATALOG_INVALID_TREATMENT_FORM_CODE');
    expect((await post({ name: 'Thiếu mã' })).body.error.code).toBe('REFERENCE_CATALOG_INVALID_TREATMENT_FORM_CODE');
    const ok = await post({ code: '1', name: 'Điều trị ngoại trú' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.code).toBe('1');
    expect((await post({ code: '1', name: 'Trùng mã' })).status).toBe(409);
    // Công ty khác không thấy.
    const otherTenant = await http().get('/api/v1/reference-catalog/TREATMENT_FORM').set(authed(doctorTenantBToken));
    expect(otherTenant.body.data.items).toEqual([]);
  });

  // ------------------------------------------------------------------ công tắc tắt
  it('công tắc liên thông TẮT: ký đơn KHÔNG xếp hàng, ô 8b ẩn (GET enabled=false, PUT 404)', async () => {
    const { encounterId } = await prepareEncounter();
    const drug = await createDrug('Thuốc khi tắt');
    const signed = await sign(encounterId, (await saveDraft(encounterId, [drug.id])).version);
    expect(signed.documents).toHaveLength(1);
    expect(await privileged.prescriptionSubmission.count({ where: { tenantId: fixture.tenantA.id } })).toBe(0);
    const info = await infoOf(encounterId);
    expect(info.status).toBe(200);
    expect(info.body.data).toMatchObject({ enabled: false, kinds: [], guardian: null, problems: [] });
    expect((await putInfo(encounterId, { kinds: [] })).status).toBe(404);
    const list = await listRows();
    expect(list).toMatchObject({ items: [], total: 0, sendEnabled: false });
  });

  // ------------------------------------------------------------------ bật liên thông
  describe('liên thông BẬT (chưa bật gửi)', () => {
    let encounterId: string;
    let codeC: string;
    let codeN: string;
    let drugC: { id: string; nationalCode: string | null };
    let drugN: { id: string; nationalCode: string | null };

    beforeAll(async () => {
      expect((await patchSettings({ enabled: true, sendEnabled: false, gatewayUrl, maxRetries: 3 })).status).toBe(200);
      expect((await http().put(`/api/v1/prescription-interop/facilities/${branchA}/credential`).set(authed(adminToken)).send({ code: 'CS-SUB-A', password: 'pw-co-so' })).status).toBe(200);
      expect((await http().put(`/api/v1/prescription-interop/doctors/${doctorUserId}/credential`).set(authed(adminToken)).send({ code: 'BS-SUB-A', password: 'pw-bac-si' })).status).toBe(200);
      const added = await http().post(`/api/v1/prescription-interop/doctors/${doctorUserId}/add-to-facility`).set(authed(adminToken));
      expect(added.body.data.outcome, JSON.stringify(added.body)).toBe('OK');
      drugC = await createDrug('Amoxicillin liên thông');
      drugN = await createDrug('Morphin liên thông', { controlType: 'NARCOTIC' });
    });

    it('đơn nháp: GET trả các loại đơn sẽ tách, gợi ý tự điền đợt dùng thuốc và danh sách thiếu (mềm — không chặn ký)', async () => {
      ({ encounterId } = await prepareEncounter());
      await saveDraft(encounterId, [drugC.id, drugN.id]);
      const res = await infoOf(encounterId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const body = res.body.data;
      expect(body).toMatchObject({ enabled: true, standardMode: true, signed: false, guardian: null });
      expect(body.kinds.map((k: any) => k.kind)).toEqual(['C', 'N']);
      const n = body.kinds.find((k: any) => k.kind === 'N');
      expect(n).toMatchObject({ nationalCode: null, submissionStatus: 'NONE', editable: true });
      // đến ngày = ngày kê + số ngày dài nhất (3) − 1.
      expect(n.suggested).toEqual({ dosePeriodNumber: 1, doseFrom: todayVn(), doseTo: addDays(todayVn(), 2) });
      const codes = body.problems.map((p: any) => `${p.kind}:${p.code}`);
      expect(codes).toContain('C:TREATMENT_FORM_MISSING');
      expect(codes).not.toContain('N:DOSE_PERIOD_MISSING');
      // Chứng chỉ hành nghề chỉ nhắc, không chặn.
      expect(body.problems.find((p: any) => p.code === 'DOCTOR_LICENSE_MISSING')).toMatchObject({ required: false });
      expect(await privileged.prescriptionSubmission.count({ where: { tenantId: fixture.tenantA.id } })).toBe(0);
    });

    it('lưu ô 8b: loại đơn lạ/ngày ngược/hình thức ngoài danh mục bị từ chối; hợp lệ thì lưu, ghi nhật ký (chỉ TÊN ô), bỏ cảnh báo; vai trò khác bị chặn', async () => {
      expect((await putInfo(encounterId, { kinds: [{ kind: 'Y', ...emptyKind }] })).status).toBe(422);
      expect((await putInfo(encounterId, { kinds: [{ kind: 'N', ...emptyKind, dosePeriodNumber: 1, doseFrom: '2026-10-25', doseTo: '2026-10-21' }] })).status).toBe(422);
      expect((await putInfo(encounterId, { kinds: [{ kind: 'C', ...emptyKind, treatmentFormCode: '99' }] })).status).toBe(422);
      expect((await putInfo(encounterId, { kinds: [{ kind: 'C', ...emptyKind, treatmentFormCode: 'ab' }] })).status).toBe(400);
      expect((await putInfo(encounterId, { kinds: [{ kind: 'C', ...emptyKind, treatmentFormCode: '1' }], })).status).toBe(200);
      const saved = await putInfo(encounterId, {
        kinds: [
          { kind: 'C', ...emptyKind, treatmentFormCode: '1' },
          { kind: 'N', ...emptyKind, dosePeriodNumber: 2, doseFrom: addDays(todayVn(), 1), doseTo: addDays(todayVn(), 5), herbalInstruction: 'Không có nghĩa với đơn N' },
        ],
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const n = saved.body.data.kinds.find((k: any) => k.kind === 'N');
      expect(n.info).toMatchObject({ dosePeriodNumber: 2, doseFrom: addDays(todayVn(), 1), doseTo: addDays(todayVn(), 5), herbalInstruction: null });
      expect(saved.body.data.kinds.find((k: any) => k.kind === 'C').info.treatmentFormCode).toBe('1');
      expect(saved.body.data.problems.map((p: any) => p.code)).not.toContain('TREATMENT_FORM_MISSING');

      const audits = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'encounter.interop_info_updated', entityId: encounterId } });
      expect(audits.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(audits)).not.toContain('Không có nghĩa');
      expect(JSON.stringify(audits.map((a) => a.afterJson))).toContain('hình thức điều trị');

      // Lễ tân không có quyền kê đơn → không sửa được; không có quyền xem lâm sàng → không xem được.
      expect((await putInfo(encounterId, { kinds: [] }, receptionistToken)).status).toBe(403);
      expect((await infoOf(encounterId, receptionistToken)).status).toBe(403);
    });

    it('ký 2 loại → xếp 2 dòng PENDING đúng mã/loại/bác sĩ/chi nhánh; danh sách có số mục thiếu; chưa bật gửi nên "Gửi ngay" bị từ chối', async () => {
      const draft = await saveDraft(encounterId, [drugC.id, drugN.id]);
      const signed = await sign(encounterId, draft.version);
      codeC = signed.documents.find((d) => d.kind === 'C')!.nationalCode;
      codeN = signed.documents.find((d) => d.kind === 'N')!.nationalCode;
      const rows = await privileged.prescriptionSubmission.findMany({ where: { tenantId: fixture.tenantA.id, encounterId } });
      expect(rows.map((r) => r.kind).sort()).toEqual(['C', 'N']);
      for (const r of rows) {
        expect(r).toMatchObject({ status: 'PENDING', attempts: 0, branchId: branchA, doctorUserId, lockedUntil: null, sentAt: null });
      }

      const list = await listRows();
      expect(list.sendEnabled).toBe(false);
      const rowC = list.items.find((i: any) => i.nationalCode === codeC);
      expect(rowC).toMatchObject({ kind: 'C', status: 'PENDING', missingCount: 0, encounterId });
      expect(rowC.doctorName).toBe('User doctorA');
      expect(list.items.find((i: any) => i.nationalCode === codeN)).toMatchObject({ kind: 'N', missingCount: 0 });

      const res = await sendRow(rowC.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INTEROP_SEND_DISABLED');
      expect(submitCalls()).toHaveLength(0);

      // Lọc theo trạng thái / ngày ký.
      expect((await listRows(doctorToken, '?status=SENT')).total).toBe(0);
      expect((await listRows(doctorToken, `?dateFrom=${todayVn()}&dateTo=${todayVn()}`)).total).toBeGreaterThanOrEqual(2);
      expect((await listRows(doctorToken, `?dateFrom=${addDays(todayVn(), 5)}`)).total).toBe(0);
    });

    it('lễ tân không xem được hàng chờ; không đăng nhập thì 401', async () => {
      expect((await http().get('/api/v1/prescription-interop/submissions').set(authed(receptionistToken))).status).toBe(403);
      expect((await http().get('/api/v1/prescription-interop/submissions')).status).toBe(401);
    });

    it('cô lập: bác sĩ chi nhánh khác không thấy/không gửi/không xem ô 8b của lượt khám; công ty khác cũng vậy', async () => {
      const rowId = (await dbRow(codeC)).id;
      const otherBranch = await listRows(doctorBToken);
      expect(otherBranch).toMatchObject({ items: [], total: 0 });
      expect((await sendRow(rowId, doctorBToken)).status).toBe(404);
      expect((await retryRow(rowId, doctorBToken)).status).toBe(404);
      // Phạm vi cá nhân đã chặn bác sĩ B vì không phải người ký — thử lại khi CHÍNH bác sĩ B là người ký của dòng, để chỉ còn ranh giới CHI NHÁNH chặn.
      const original = (await dbRow(codeC)).doctorUserId;
      await privileged.prescriptionSubmission.update({ where: { id: rowId }, data: { doctorUserId: doctorBUserId } });
      try {
        expect((await sendRow(rowId, doctorBToken)).status).toBe(404);
        expect((await retryRow(rowId, doctorBToken)).status).toBe(404);
        expect(submitCalls()).toHaveLength(0);
      } finally {
        await privileged.prescriptionSubmission.update({ where: { id: rowId }, data: { doctorUserId: original } });
      }
      expect((await infoOf(encounterId, doctorBToken)).status).toBe(404);
      expect((await putInfo(encounterId, { kinds: [] }, doctorBToken)).status).toBe(404);

      const otherTenant = await listRows(doctorTenantBToken);
      expect(otherTenant).toMatchObject({ items: [], total: 0 });
      expect((await sendRow(rowId, doctorTenantBToken)).status).toBe(404);
      // Công ty B chưa bật liên thông: chỉ nhận khung "tắt", không có dữ liệu gì của công ty A. Bật lên thì lượt khám của A là 404.
      const stub = await infoOf(encounterId, doctorTenantBToken);
      expect(stub.body.data).toMatchObject({ enabled: false, kinds: [], guardian: null, problems: [] });
      await privileged.tenantSetting.create({ data: { tenantId: fixture.tenantB.id, key: 'prescription_interop', valueJson: { enabled: true }, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
      expect((await infoOf(encounterId, doctorTenantBToken)).status).toBe(404);
      expect((await putInfo(encounterId, { kinds: [] }, doctorTenantBToken)).status).toBe(404);
      expect(await privileged.prescriptionSubmission.count({ where: { tenantId: fixture.tenantB.id } })).toBe(0);
    });

    // ------------------------------------------------------------------ bật gửi
    describe('bật "Gửi đơn lên cổng"', () => {
      beforeAll(async () => {
        expect((await patchSettings({ sendEnabled: true })).status).toBe(200);
      });

      it('gửi thành công: gói đúng tài liệu (token BÁC SĨ, mã đơn, mã thuốc, đơn vị, hình thức/đợt), ghi SENT + nhật ký, không gửi lại lần hai, khoá ô 8b', async () => {
        const rowId = (await dbRow(codeC)).id;
        const res = await sendRow(rowId);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data).toMatchObject({ outcome: 'SENT', row: { status: 'SENT', attempts: 1, missingCount: null, errors: [] } });

        expect(submitCalls()).toHaveLength(1);
        const call = submitCalls()[0]!;
        expect(call.headers.authorization).toMatch(/^bearer DOC-TOKEN-\d+$/);
        expect(call.body).toMatchObject({
          loai_don_thuoc: 'c',
          ma_don_thuoc: codeC,
          hinh_thuc_dieu_tri: 1,
          gioi_tinh: 3,
          ngay_sinh_benh_nhan: '01/01/1990',
          dia_chi: '12 Trần Thái Tông',
          thong_tin_don_thuoc: [{ ma_thuoc: drugC.nationalCode, don_vi_tinh: 'Viên', ten_thuoc: 'Amoxicillin liên thông' }],
        });
        expect(call.body.chan_doan).toHaveLength(1);
        expect(call.body.dot_dung_thuoc).toBeUndefined();

        const stored = await dbRow(codeC);
        expect(stored.status).toBe('SENT');
        expect(stored.sentAt).not.toBeNull();
        expect(stored.lockedUntil).toBeNull();
        const audits = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'prescription_interop.submission_sent', entityId: stored.id } });
        expect(audits).toHaveLength(1);
        expect(JSON.stringify(audits)).not.toMatch(/DOC-TOKEN|pw-bac-si|BS-SUB-A/);

        const again = await sendRow(rowId);
        expect(again.status).toBe(409);
        expect(again.body.error.code).toBe('INTEROP_SUBMISSION_NOT_SENDABLE');
        expect(submitCalls()).toHaveLength(1);

        const info = (await infoOf(encounterId)).body.data;
        expect(info.kinds.find((k: any) => k.kind === 'C')).toMatchObject({ submissionStatus: 'SENT', editable: false });
        expect(info.kinds.find((k: any) => k.kind === 'N')).toMatchObject({ submissionStatus: 'PENDING', editable: true });
        const locked = await putInfo(encounterId, { kinds: [{ kind: 'C', ...emptyKind, treatmentFormCode: '1' }] });
        expect(locked.status).toBe(409);
        expect(locked.body.error.code).toBe('INTEROP_INFO_LOCKED');
      });

      it('đơn N gửi kèm đợt dùng thuốc đã nhập', async () => {
        const res = await sendRow((await dbRow(codeN)).id);
        expect(res.body.data.outcome).toBe('SENT');
        const call = submitCalls().at(-1)!;
        expect(call.body.loai_don_thuoc).toBe('n');
        expect(call.body.dot_dung_thuoc).toEqual([{ dot: 2, tu_ngay: expect.stringMatching(/^\d{2}\/\d{2}\/\d{4}$/), den_ngay: expect.stringMatching(/^\d{2}\/\d{2}\/\d{4}$/) }]);
        expect(call.body.hinh_thuc_dieu_tri).toBeUndefined();
      });

      it('cổng từ chối (422): dừng ở LỖI kèm nguyên văn, bộ gửi nền KHÔNG tự thử lại; sửa xong "Gửi lại" đặt lại số lần thử và gửi được', async () => {
        const { nationalCode, row } = await signedC();
        routes['/api/v1/gui-don-thuoc'] = (res) => reply(res, 422, { danh_sach_cac_loi: ['hinh_thuc_dieu_tri: không hợp lệ'] });
        const res = await sendRow(row.id);
        expect(res.status).toBe(200);
        expect(res.body.data.outcome).toBe('REJECTED');
        expect(res.body.data.row).toMatchObject({ status: 'FAILED', attempts: 1, lastHttpStatus: 422, errors: ['hinh_thuc_dieu_tri: không hợp lệ'] });
        const failed = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'prescription_interop.submission_failed', entityId: row.id } });
        expect(failed).toHaveLength(1);

        calls = [];
        expect(await submissionService.runDueForTenant(fixture.tenantA.id)).toBe(0);
        expect(submitCalls()).toHaveLength(0);

        routes['/api/v1/gui-don-thuoc'] = (res2) => reply(res2, 200, { success: 'ok' });
        const retried = await retryRow(row.id);
        expect(retried.body.data).toMatchObject({ outcome: 'SENT', row: { status: 'SENT', attempts: 1, errors: [] } });
        const stored = await dbRow(nationalCode);
        expect(stored.status).toBe('SENT');
        const retriedAudit = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'prescription_interop.submission_retried', entityId: row.id } });
        expect(retriedAudit.length).toBeGreaterThanOrEqual(2);
      });

      it('mất kết nối (503): giữ "Chờ gửi" hẹn thử lại sau ~1 phút; hết số lần thử (maxRetries=2) thì dừng ở LỖI', async () => {
        expect((await patchSettings({ maxRetries: 2 })).status).toBe(200);
        const { row } = await signedC();
        routes['/api/v1/gui-don-thuoc'] = (res) => reply(res, 503, { message: 'Service Unavailable' });
        const first = await sendRow(row.id);
        expect(first.body.data.outcome).toBe('UNREACHABLE');
        expect(first.body.data.row).toMatchObject({ status: 'PENDING', attempts: 1, maxRetries: 2 });
        expect(first.body.data.row.errors[0]).toContain('Chưa kết nối được cổng');
        const wait = new Date(first.body.data.row.nextAttemptAt).getTime() - Date.now();
        expect(wait).toBeGreaterThan(40_000);
        expect(wait).toBeLessThan(75_000);

        const second = await sendRow(row.id);
        expect(second.body.data.row).toMatchObject({ status: 'FAILED', attempts: 2 });
        expect((await patchSettings({ maxRetries: 3 })).status).toBe(200);
      });

      it('cổng trả 401 (token bác sĩ hết hạn): đăng nhập bác sĩ lại và thử đúng MỘT lần nữa', async () => {
        const { row } = await signedC();
        const loginsBefore = doctorLoginCount;
        let submits = 0;
        routes['/api/v1/gui-don-thuoc'] = (res) => (++submits === 1 ? reply(res, 401, { message: 'Unauthenticated' }) : reply(res, 200, { success: 'ok' }));
        const res = await sendRow(row.id);
        expect(res.body.data.outcome).toBe('SENT');
        expect(submitCalls()).toHaveLength(2);
        expect(doctorLoginCount).toBe(loginsBefore + 1);
        expect(submitCalls()[0]!.headers.authorization).not.toBe(submitCalls()[1]!.headers.authorization);
      });

      it('dữ liệu chưa đủ: KHÔNG gọi cổng, giữ "Chờ gửi" hẹn xem lại sau 30 phút; bổ sung ô 8b thì đến hạn ngay và bộ gửi nền gửi được', async () => {
        const { encounterId: encId, nationalCode, row } = await signedC({ withTreatmentForm: false });
        const res = await sendRow(row.id);
        expect(res.body.data.outcome).toBe('NOT_READY');
        expect(submitCalls()).toHaveLength(0);
        expect(res.body.data.row).toMatchObject({ status: 'PENDING', attempts: 0, missingCount: 1 });
        expect(res.body.data.row.missing[0].code).toBe('TREATMENT_FORM_MISSING');
        const held = await dbRow(nationalCode);
        const wait = held.nextAttemptAt!.getTime() - Date.now();
        expect(wait).toBeGreaterThan(25 * 60_000);
        expect(wait).toBeLessThan(35 * 60_000);

        // Chưa đến hạn → bộ gửi nền bỏ qua.
        expect(await submissionService.runDueForTenant(fixture.tenantA.id)).toBe(0);

        expect((await putInfo(encId, { kinds: [{ kind: 'C', ...emptyKind, treatmentFormCode: '1' }] })).status).toBe(200);
        expect((await dbRow(nationalCode)).nextAttemptAt).toBeNull();
        expect(await submissionService.runDueForTenant(fixture.tenantA.id)).toBe(1);
        expect((await dbRow(nationalCode)).status).toBe('SENT');
        expect(submitCalls()).toHaveLength(1);
      });

      it('thiếu mã/mật khẩu liên thông của bác sĩ: NOT_CONFIGURED, giữ chờ, không gọi cổng gửi đơn', async () => {
        const { nationalCode, row } = await signedC();
        // Tạm gỡ mã/mật khẩu liên thông của bác sĩ ký đơn.
        const credential = await privileged.interopDoctorCredential.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, userId: doctorUserId, deletedAt: null } });
        await privileged.interopDoctorCredential.update({ where: { id: credential.id }, data: { deletedAt: new Date(), deletedReason: 'test' } });
        let res;
        try {
          res = await sendRow(row.id);
        } finally {
          await privileged.interopDoctorCredential.update({ where: { id: credential.id }, data: { deletedAt: null, deletedReason: null } });
        }
        expect(res.body.data.outcome).toBe('NOT_CONFIGURED');
        expect(submitCalls()).toHaveLength(0);
        expect((await dbRow(nationalCode)).status).toBe('PENDING');
        expect(res.body.data.row.errors[0]).toContain('mã liên thông của bác sĩ');
      });

      it('đơn đang được tiến trình khác gửi ("thuê" còn hạn): 409 bận và bộ gửi nền bỏ qua', async () => {
        // Các đơn còn đến hạn từ ca trước được xử lý hết trước, để phép đếm bên dưới chỉ nói về dòng đang bị "thuê".
        await submissionService.runDueForTenant(fixture.tenantA.id);
        const { nationalCode, row } = await signedC();
        calls = [];
        await privileged.prescriptionSubmission.update({ where: { id: row.id }, data: { lockedUntil: new Date(Date.now() + 120_000) } });
        const res = await sendRow(row.id);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INTEROP_SUBMISSION_NOT_SENDABLE');
        expect(await submissionService.runDueForTenant(fixture.tenantA.id)).toBe(0);
        expect(submitCalls()).toHaveLength(0);
        // Hết hạn "thuê" (máy chủ sập giữa chừng) → gửi lại được.
        await privileged.prescriptionSubmission.update({ where: { id: row.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
        expect(await submissionService.runDueForTenant(fixture.tenantA.id)).toBe(1);
        expect((await dbRow(nationalCode)).status).toBe('SENT');
      });

      it('bộ gửi nền không chạy khi tắt "Gửi đơn lên cổng" hoặc tắt liên thông', async () => {
        const { nationalCode } = await signedC();
        expect((await patchSettings({ sendEnabled: false })).status).toBe(200);
        expect(await submissionService.runDueForTenant(fixture.tenantA.id)).toBe(0);
        expect((await patchSettings({ sendEnabled: true, enabled: false })).status).toBe(200);
        expect(await submissionService.runDueForTenant(fixture.tenantA.id)).toBe(0);
        expect(submitCalls()).toHaveLength(0);
        expect((await patchSettings({ enabled: true })).status).toBe(200);
        expect(await submissionService.runDueForTenant(fixture.tenantA.id)).toBe(1);
        expect((await dbRow(nationalCode)).status).toBe('SENT');
      });

      it('bộ gửi nền theo từng công ty: công ty không bật liên thông không bị đụng tới', async () => {
        expect(await submissionService.runDueForTenant(fixture.tenantB.id)).toBe(0);
      });
    });

    // ------------------------------------------------------------------ đính chính
    describe('đính chính đơn', () => {
      it('đơn chưa gửi: giữ mã, dòng hàng chờ trỏ sang đơn pháp lý mới; thêm loại mới thì xếp hàng; bỏ loại thì huỷ dòng; đã gửi thì thành "Đính chính, chưa gửi" và KHÔNG gửi lại', async () => {
        const { encounterId: encId } = await prepareEncounter();
        const d1 = await createDrug('Thuốc C đính chính');
        const dn = await createDrug('Morphin đính chính', { controlType: 'NARCOTIC' });
        const signed = await sign(encId, (await saveDraft(encId, [d1.id])).version);
        const codeOnlyC = signed.documents[0]!.nationalCode;
        const firstRow = await dbRow(codeOnlyC);
        expect(firstRow.status).toBe('PENDING');

        // 1) Đính chính vẫn chỉ loại C: giữ mã + trạng thái, trỏ đơn pháp lý mới.
        const a1 = await amend(encId, signed.version, [d1.id]);
        expect(a1.documents[0]!.nationalCode).toBe(codeOnlyC);
        const afterA1 = await dbRow(codeOnlyC);
        expect(afterA1).toMatchObject({ id: firstRow.id, status: 'PENDING', prescriptionDocumentId: a1.documents[0]!.id });
        expect(afterA1.prescriptionDocumentId).not.toBe(firstRow.prescriptionDocumentId);

        // 2) Thêm thuốc gây nghiện → loại N mới được xếp hàng.
        const a2 = await amend(encId, a1.version, [d1.id, dn.id]);
        const codeNew = a2.documents.find((d) => d.kind === 'N')!.nationalCode;
        expect(await dbRow(codeNew)).toMatchObject({ kind: 'N', status: 'PENDING', doctorUserId });

        // 3) Gửi đơn C (qua cấu hình gửi) rồi đính chính lại → C thành AMENDED, không gửi thêm lần nào.
        const notReady = await sendRow(firstRow.id);
        expect(notReady.status, JSON.stringify(notReady.body)).toBe(200);
        expect(notReady.body.data.outcome).toBe('NOT_READY');
        expect((await putInfo(encId, { kinds: [{ kind: 'C', ...emptyKind, treatmentFormCode: '1' }] })).status).toBe(200);
        expect((await sendRow(firstRow.id)).body.data.outcome).toBe('SENT');
        calls = [];
        const a3 = await amend(encId, a2.version, [d1.id]);
        expect(await dbRow(codeOnlyC)).toMatchObject({ status: 'AMENDED', prescriptionDocumentId: a3.documents[0]!.id });
        expect(await submissionService.runDueForTenant(fixture.tenantA.id)).toBe(0);
        expect(submitCalls()).toHaveLength(0);
        const amendedRow = (await listRows()).items.find((i: any) => i.nationalCode === codeOnlyC);
        expect(amendedRow).toMatchObject({ status: 'AMENDED', missingCount: null });
        expect((await sendRow(firstRow.id)).status).toBe(409);
        expect((await retryRow(firstRow.id)).status).toBe(409);

        // 4) Loại N bị bỏ khi đính chính → dòng PENDING bị huỷ mềm (không xoá cứng).
        const droppedN = await privileged.prescriptionSubmission.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, nationalCode: codeNew } });
        expect(droppedN.deletedAt).not.toBeNull();
        expect(droppedN.deletedReason).toBe('amended_removed');
        expect((await listRows()).items.some((i: any) => i.nationalCode === codeNew)).toBe(false);
      });
    });
  });

  // ------------------------------------------------------------------ người giám hộ
  describe('người giám hộ (bệnh nhân dưới 72 tháng tuổi)', () => {
    it('GET hiện khối người giám hộ + cảnh báo thiếu; PUT ghi ngược vào hồ sơ bệnh nhân, đúng phiên bản; người lớn không có khối này', async () => {
      const child = await prepareEncounter('2024-03-01');
      const drug = await createDrug('Siro trẻ em');
      await saveDraft(child.encounterId, [drug.id]);
      const before = (await infoOf(child.encounterId)).body.data;
      expect(before.guardian).toMatchObject({ fullName: null, phone: null, address: null, canEdit: true });
      expect(before.problems.map((p: any) => p.code)).toContain('GUARDIAN_MISSING');

      const patientBefore = (await http().get(`/api/v1/patients/${child.patientId}`).set(authed(doctorToken))).body.data;
      const stale = await putInfo(child.encounterId, { kinds: [], guardian: { fullName: 'Lê Thị Hoa', patientVersion: patientBefore.version + 5 } });
      expect(stale.status).toBe(409);

      const saved = await putInfo(child.encounterId, {
        kinds: [{ kind: 'C', ...emptyKind, treatmentFormCode: '1' }],
        guardian: { fullName: 'Lê Thị Hoa', phone: '0988777666', address: '23 Nguyễn Trãi, Thanh Xuân', patientVersion: before.guardian.patientVersion },
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body.data.guardian).toMatchObject({ fullName: 'Lê Thị Hoa', phone: '0988777666', address: '23 Nguyễn Trãi, Thanh Xuân' });
      expect(saved.body.data.problems.map((p: any) => p.code)).not.toContain('GUARDIAN_MISSING');
      const patientAfter = (await http().get(`/api/v1/patients/${child.patientId}`).set(authed(doctorToken))).body.data;
      expect(patientAfter).toMatchObject({ relativeFullName: 'Lê Thị Hoa', relativePhone: '0988777666', relativeAddress: '23 Nguyễn Trãi, Thanh Xuân' });
      expect(patientAfter.version).toBeGreaterThan(patientBefore.version);

      // Gói gửi đi mang thông tin người giám hộ.
      const signed = await sign(child.encounterId, (await saveDraft(child.encounterId, [drug.id])).version);
      expect((await patchSettings({ sendEnabled: true })).status).toBe(200);
      const row = await dbRow(signed.documents[0]!.nationalCode);
      const sent = await sendRow(row.id);
      expect(sent.body.data.outcome, JSON.stringify(sent.body)).toBe('SENT');
      expect(submitCalls().at(-1)!.body.thong_tin_nguoi_giam_ho).toBe('Lê Thị Hoa, 0988777666, 23 Nguyễn Trãi, Thanh Xuân');

      const adult = await prepareEncounter();
      await saveDraft(adult.encounterId, [drug.id]);
      expect((await infoOf(adult.encounterId)).body.data.guardian).toBeNull();
    });
  });
});
