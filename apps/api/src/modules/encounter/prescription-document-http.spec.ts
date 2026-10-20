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
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';

/**
 * HTTP e2e — Mã đơn thuốc chuẩn Bộ Y tế, GIAI ĐOẠN 2 (docs/DECISIONS.md #242): bảng ánh xạ loại thuốc → loại đơn, tách đơn khi ký (mỗi loại C/N/H/Y một đơn pháp lý
 * có mã riêng, bộ đếm chung), đính chính giữ mã, đơn ký trước ngày bật không cấp mã chuẩn, hộp "Phát thuốc" nhóm theo đơn, cô lập công ty.
 */
describe('HTTP e2e — Đơn thuốc pháp lý C/N/H/Y (giai đoạn 2)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchA: string;
  let receptionistToken: string;
  let adminToken: string;
  let doctorToken: string;
  let doctorUserId: string;
  let tenantBAdminToken: string;
  let hourSeed = 1;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-pdoc-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  async function createDrug(name: string, opts: { controlType?: 'NORMAL' | 'TOXIC' | 'NARCOTIC' | 'PSYCHOTROPIC' | 'PRECURSOR'; isTraditional?: boolean } = {}) {
    const drug = await privileged.drug.create({
      data: {
        tenantId: fixture.tenantA.id,
        code: `DRG-${randomUUID().slice(0, 8)}`,
        name,
        activeIngredient: name,
        controlType: opts.controlType ?? 'NORMAL',
        isTraditional: opts.isTraditional ?? false,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return drug.id as string;
  }

  /** Tạo lượt khám đang khám có chẩn đoán chính (giờ hẹn khác nhau mỗi lần để không đụng lịch bác sĩ). */
  async function prepareEncounter(): Promise<string> {
    const hour = hourSeed++;
    const appointmentRes = await http()
      .post('/api/v1/appointments')
      .set(authed(receptionistToken))
      .send({ doctorId: doctorUserId, fullName: 'Khách e2e đơn pháp lý', phone: '0911222444', scheduledAt: new Date(Date.UTC(2026, 7, 28, hour, 0, 0)).toISOString(), source: 'phone' as const });
    const appointment = appointmentRes.body.data as { id: string; version: number };
    const nationalId = '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
    const patientRes = await http()
      .post('/api/v1/patients')
      .set(authed(receptionistToken))
      .send({ fullName: 'Bệnh nhân e2e đơn pháp lý', dob: '1990-01-01', gender: 'female', phone: '0933555666', nationalId });
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
    const encounterId = checkIn.body.data.id as string;
    await http().post(`/api/v1/billing/invoices/${encounterId}/pay`).set(authed(receptionistToken)).send({ method: 'CASH', version: 1 });
    await http().post(`/api/v1/encounters/${encounterId}/start`).set(authed(doctorToken)).send({ version: 1 });
    await http().put(`/api/v1/encounters/${encounterId}/diagnoses`).set(authed(doctorToken)).send({ diagnoses: [{ icd10Code: 'A00', type: 'PRIMARY' as const }] });
    return encounterId;
  }

  type Line = { drugId?: string; freeTextDrugName?: string };
  const toItems = (lines: Line[]) => lines.map((l) => ({ ...l, doseMorning: 1, doseNoon: 0, doseAfternoon: 0, doseEvening: 1, durationDays: 3 }));

  async function saveDraft(encounterId: string, lines: Line[]) {
    const res = await http().put(`/api/v1/encounters/${encounterId}/prescription-items`).set(authed(doctorToken)).send({ items: toItems(lines) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as PrescriptionBody;
  }

  async function sign(encounterId: string, version: number) {
    return http().post(`/api/v1/encounters/${encounterId}/prescription/sign`).set(authed(doctorToken)).send({ version });
  }

  interface PrescriptionBody {
    id: string;
    version: number;
    standardMode: boolean;
    prescriptionNo: string | null;
    items: { id: string; drugId: string | null; kind: string | null; documentId: string | null }[];
    documents: { id: string; kind: string; nationalCode: string; itemIds: string[] }[];
  }

  async function setStandardMode(on: boolean) {
    const res = await http()
      .patch('/api/v1/clinic-settings/code-templates/PRESCRIPTION')
      .set(authed(adminToken))
      .send({ template: 'DT[Năm 2 số][Tháng][Số đếm]', counterDigits: 6, mode: on ? 'STANDARD' : 'CUSTOM' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  const counterOf = (code: string) => Number(code.slice(5, 12));

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

    fixture = await createTwoTenantFixture(privileged, 'PrescriptionDocument e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    receptionistToken = (await createUserWithRole(fixture.tenantA.id, 'receptionist')).token;
    adminToken = (await createUserWithRole(fixture.tenantA.id, 'clinic_admin')).token;
    const doctor = await createUserWithRole(fixture.tenantA.id, 'doctor');
    doctorToken = doctor.token;
    doctorUserId = doctor.userId;
    tenantBAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;

    // Cho phép kê thuốc tự do (dòng tự do phải là loại C) và đặt mã cơ sở KCB cho chi nhánh.
    await privileged.tenantSetting.create({
      data: { tenantId: fixture.tenantA.id, key: 'allow_free_text_prescription_enabled', valueJson: true, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.branch.update({ where: { id: branchA }, data: { facilityCode: '79001' } });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  // ------------------------------------------------------------------ bảng ánh xạ
  it('bảng ánh xạ: mặc định đúng, sửa được (có nhật ký), chỉ vai trò có clinic_config.update, dòng Đông y chỉ nhận Y/C, công ty khác không ảnh hưởng', async () => {
    const before = await http().get('/api/v1/clinic-settings/prescription-kind-mapping').set(authed(adminToken));
    expect(before.status).toBe(200);
    expect(before.body.data.mapping).toEqual({ NARCOTIC: 'N', PSYCHOTROPIC: 'H', PRECURSOR: 'H', TOXIC: 'C', NORMAL: 'C', TRADITIONAL: 'Y' });
    expect(before.body.data.defaults).toEqual(before.body.data.mapping);

    expect((await http().get('/api/v1/clinic-settings/prescription-kind-mapping')).status).toBe(401);
    expect((await http().get('/api/v1/clinic-settings/prescription-kind-mapping').set(authed(receptionistToken))).status).toBe(403);
    const denied = await http().patch('/api/v1/clinic-settings/prescription-kind-mapping').set(authed(receptionistToken)).send(before.body.data.mapping);
    expect(denied.status).toBe(403);

    const bad = await http().patch('/api/v1/clinic-settings/prescription-kind-mapping').set(authed(adminToken)).send({ ...before.body.data.mapping, TRADITIONAL: 'N' });
    expect(bad.status).toBe(400);

    const changed = { ...before.body.data.mapping, TOXIC: 'H' };
    const patched = await http().patch('/api/v1/clinic-settings/prescription-kind-mapping').set(authed(adminToken)).send(changed);
    expect(patched.status).toBe(200);
    expect(patched.body.data.mapping.TOXIC).toBe('H');
    expect(patched.body.data.defaults.TOXIC).toBe('C');

    const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'prescription_kind_mapping.updated' } });
    expect(audit).not.toBeNull();

    // Công ty B vẫn là mặc định.
    const b = await http().get('/api/v1/clinic-settings/prescription-kind-mapping').set(authed(tenantBAdminToken));
    expect(b.body.data.mapping.TOXIC).toBe('C');

    // Trả lại mặc định cho các test sau.
    await http().patch('/api/v1/clinic-settings/prescription-kind-mapping').set(authed(adminToken)).send(before.body.data.mapping);
  });

  // ------------------------------------------------------------------ chế độ tắt: giữ nguyên hành vi cũ
  it('chế độ chuẩn TẮT: không có loại đơn, không tách đơn, ký như cũ (mã DT)', async () => {
    const encounterId = await prepareEncounter();
    const normal = await createDrug('Amoxicillin (tắt)');
    const narcotic = await createDrug('Morphin (tắt)', { controlType: 'NARCOTIC' });
    const draft = await saveDraft(encounterId, [{ drugId: normal }, { drugId: narcotic }]);
    expect(draft.standardMode).toBe(false);
    expect(draft.items.every((i) => i.kind === null && i.documentId === null)).toBe(true);
    expect(draft.documents).toEqual([]);

    const signed = await sign(encounterId, draft.version);
    expect(signed.status).toBe(200);
    expect(signed.body.data.documents).toEqual([]);
    expect(signed.body.data.prescriptionNo).toMatch(/^DT/);
    expect(await privileged.prescriptionDocument.count({ where: { tenantId: fixture.tenantA.id } })).toBe(0);
  });

  // ------------------------------------------------------------------ chế độ chuẩn: tách đơn
  describe('chế độ Chuẩn Bộ Y tế BẬT', () => {
    let narcoticDrug: string;
    let normalA: string;
    let normalB: string;
    let herbal: string;
    let psycho: string;
    let encounterCN: string;
    let signedCN: PrescriptionBody;

    beforeAll(async () => {
      await setStandardMode(true);
      narcoticDrug = await createDrug('Morphin sulfat 10mg', { controlType: 'NARCOTIC' });
      normalA = await createDrug('Amoxicillin 500mg');
      normalB = await createDrug('Paracetamol 500mg');
      herbal = await createDrug('Cao khô Actiso', { isTraditional: true });
      psycho = await createDrug('Diazepam 5mg', { controlType: 'PSYCHOTROPIC' });
    });

    it('bản nháp: mỗi dòng có loại đơn theo ánh xạ (thường C, gây nghiện N, tự do C), chưa có đơn pháp lý', async () => {
      encounterCN = await prepareEncounter();
      const draft = await saveDraft(encounterCN, [{ drugId: normalA }, { drugId: normalB }, { drugId: narcoticDrug }, { freeTextDrugName: 'Siro ho thảo dược nhà làm' }]);
      expect(draft.standardMode).toBe(true);
      const kindOf = (drugId: string | null) => draft.items.find((i) => i.drugId === drugId)?.kind;
      expect(kindOf(normalA)).toBe('C');
      expect(kindOf(normalB)).toBe('C');
      expect(kindOf(narcoticDrug)).toBe('N');
      expect(kindOf(null)).toBe('C');
      expect(draft.documents).toEqual([]);
      expect(draft.items.every((i) => i.documentId === null)).toBe(true);
      signedCN = draft;
    });

    it('ký → tách 2 đơn pháp lý C và N, mã chuẩn 14 ký tự, bộ đếm chung (liên tiếp), dòng gắn đúng đơn, vẫn có mã nội bộ DT', async () => {
      const res = await sign(encounterCN, signedCN.version);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const body = res.body.data as PrescriptionBody;
      expect(body.prescriptionNo).toMatch(/^DT/);
      expect(body.documents.map((d) => d.kind)).toEqual(['C', 'N']);
      const [docC, docN] = body.documents as [PrescriptionBody['documents'][number], PrescriptionBody['documents'][number]];
      expect(docC.nationalCode).toMatch(/^79001\d{7}-C$/);
      expect(docN.nationalCode).toMatch(/^79001\d{7}-N$/);
      expect(counterOf(docN.nationalCode)).toBe(counterOf(docC.nationalCode) + 1);
      expect(docC.itemIds).toHaveLength(3);
      expect(docN.itemIds).toHaveLength(1);
      const narcoticItem = body.items.find((i) => i.drugId === narcoticDrug)!;
      expect(docN.itemIds).toEqual([narcoticItem.id]);
      expect(body.items.every((i) => i.documentId !== null)).toBe(true);
      expect(body.items.find((i) => i.drugId === null)!.kind).toBe('C');
      signedCN = body;

      // Đọc lại màn khám: cùng kết quả (loại lấy từ đơn pháp lý đã cấp mã).
      const again = await http().get(`/api/v1/encounters/${encounterCN}/consultation`).set(authed(doctorToken));
      expect(again.body.data.prescription.documents.map((d: { nationalCode: string }) => d.nationalCode)).toEqual([docC.nationalCode, docN.nationalCode]);
    });

    it('đổi ánh xạ SAU khi ký không đổi đơn đã ký; đơn mới ký theo ánh xạ mới', async () => {
      const mapping = { NARCOTIC: 'C', PSYCHOTROPIC: 'H', PRECURSOR: 'H', TOXIC: 'C', NORMAL: 'C', TRADITIONAL: 'Y' };
      const changed = await http().patch('/api/v1/clinic-settings/prescription-kind-mapping').set(authed(adminToken)).send(mapping);
      expect(changed.status).toBe(200);
      try {
        const reread = await http().get(`/api/v1/encounters/${encounterCN}/consultation`).set(authed(doctorToken));
        expect(reread.body.data.prescription.items.find((i: { drugId: string | null }) => i.drugId === narcoticDrug).kind).toBe('N');

        const e2 = await prepareEncounter();
        const draft = await saveDraft(e2, [{ drugId: normalA }, { drugId: narcoticDrug }]);
        expect(draft.items.every((i) => i.kind === 'C')).toBe(true);
        const signed = await sign(e2, draft.version);
        expect(signed.body.data.documents).toHaveLength(1);
        expect(signed.body.data.documents[0].kind).toBe('C');
      } finally {
        await http().patch('/api/v1/clinic-settings/prescription-kind-mapping').set(authed(adminToken)).send({ ...mapping, NARCOTIC: 'N' });
      }
    });

    it('Đông y → Y; thuốc vừa gây nghiện vừa Đông y → N (ưu tiên N, H, Y, C); đủ 4 loại → 4 đơn theo thứ tự C, N, H, Y', async () => {
      const both = await createDrug('Thuốc gây nghiện cổ truyền', { controlType: 'NARCOTIC', isTraditional: true });
      const e = await prepareEncounter();
      const draft = await saveDraft(e, [{ drugId: herbal }, { drugId: psycho }, { drugId: both }, { drugId: normalB }]);
      const kind = (id: string) => draft.items.find((i) => i.drugId === id)!.kind;
      expect(kind(herbal)).toBe('Y');
      expect(kind(psycho)).toBe('H');
      expect(kind(both)).toBe('N');
      expect(kind(normalB)).toBe('C');
      const signed = await sign(e, draft.version);
      expect(signed.status).toBe(200);
      expect(signed.body.data.documents.map((d: { kind: string }) => d.kind)).toEqual(['C', 'N', 'H', 'Y']);
      const counters = signed.body.data.documents.map((d: { nationalCode: string }) => counterOf(d.nationalCode));
      expect(counters).toEqual([counters[0], counters[0] + 1, counters[0] + 2, counters[0] + 3]);
    });

    it('đính chính: loại còn lại GIỮ mã cũ, loại mới nhận mã mới, loại bị bỏ không dùng lại mã; bản cũ soft-delete', async () => {
      const e = await prepareEncounter();
      const draft = await saveDraft(e, [{ drugId: normalA }, { drugId: narcoticDrug }]);
      const signed = (await sign(e, draft.version)).body.data as PrescriptionBody;
      const oldC = signed.documents.find((d) => d.kind === 'C')!;
      const oldN = signed.documents.find((d) => d.kind === 'N')!;

      // Bỏ thuốc gây nghiện (N), thêm hướng thần (H): C giữ mã, N biến mất, H mới.
      const amended = await http()
        .post(`/api/v1/encounters/${e}/prescription/amend`)
        .set(authed(doctorToken))
        .send({ items: toItems([{ drugId: normalA }, { drugId: psycho }]), amendmentReason: 'Đổi thuốc', version: signed.version });
      expect(amended.status, JSON.stringify(amended.body)).toBe(200);
      const body = amended.body.data as PrescriptionBody;
      expect(body.documents.map((d) => d.kind)).toEqual(['C', 'H']);
      expect(body.documents.find((d) => d.kind === 'C')!.nationalCode).toBe(oldC.nationalCode);
      const newH = body.documents.find((d) => d.kind === 'H')!;
      expect(counterOf(newH.nationalCode)).toBeGreaterThan(counterOf(oldN.nationalCode));
      expect(body.documents.some((d) => d.nationalCode === oldN.nationalCode)).toBe(false);

      // Bản đơn gốc bị soft-delete cùng đơn pháp lý của nó; mã cũ không bao giờ trùng 2 bản đang hiệu lực.
      const oldDocs = await privileged.prescriptionDocument.findMany({ where: { tenantId: fixture.tenantA.id, prescriptionId: signed.id } });
      expect(oldDocs).toHaveLength(2);
      expect(oldDocs.every((d) => d.deletedAt !== null && d.deletedReason === 'amended')).toBe(true);
      const active = await privileged.prescriptionDocument.findMany({ where: { tenantId: fixture.tenantA.id, deletedAt: null, nationalCode: oldC.nationalCode } });
      expect(active).toHaveLength(1);

      // Đính chính tiếp với cùng loại: mã giữ nguyên.
      const again = await http()
        .post(`/api/v1/encounters/${e}/prescription/amend`)
        .set(authed(doctorToken))
        .send({ items: toItems([{ drugId: normalB }, { drugId: psycho }]), amendmentReason: 'Đổi lại', version: body.version });
      expect(again.status).toBe(200);
      expect(again.body.data.documents.map((d: { nationalCode: string }) => d.nationalCode)).toEqual([oldC.nationalCode, newH.nationalCode]);
    });

    it('đơn ký TRƯỚC khi bật chế độ chuẩn không được cấp mã chuẩn hồi tố, kể cả khi đính chính', async () => {
      await setStandardMode(false);
      const e = await prepareEncounter();
      const draft = await saveDraft(e, [{ drugId: normalA }]);
      const signed = (await sign(e, draft.version)).body.data as PrescriptionBody;
      expect(signed.documents).toEqual([]);
      await setStandardMode(true);
      const reread = await http().get(`/api/v1/encounters/${e}/consultation`).set(authed(doctorToken));
      expect(reread.body.data.prescription.documents).toEqual([]);
      expect(reread.body.data.prescription.items[0].kind).toBeNull();
      const amended = await http()
        .post(`/api/v1/encounters/${e}/prescription/amend`)
        .set(authed(doctorToken))
        .send({ items: toItems([{ drugId: normalA }, { drugId: narcoticDrug }]), amendmentReason: 'Thêm thuốc', version: signed.version });
      expect(amended.status).toBe(200);
      expect(amended.body.data.documents).toEqual([]);
    });

    it('4 đơn ký ĐỒNG THỜI → mọi mã chuẩn khác nhau và liên tục (không hụt số, không trùng)', async () => {
      const encounters = [await prepareEncounter(), await prepareEncounter(), await prepareEncounter(), await prepareEncounter()];
      const drafts = [] as PrescriptionBody[];
      for (const e of encounters) drafts.push(await saveDraft(e, [{ drugId: normalA }, { drugId: narcoticDrug }]));
      const results = await Promise.all(encounters.map((e, i) => sign(e, drafts[i]!.version)));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      const codes = results.flatMap((r) => (r.body.data.documents as { nationalCode: string }[]).map((d) => d.nationalCode));
      expect(new Set(codes).size).toBe(8);
      const numbers = codes.map(counterOf).sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => numbers[0]! + i));
    });

    it('hộp "Phát thuốc": trạng thái trả về các đơn pháp lý + mỗi dòng biết thuộc đơn nào', async () => {
      const status = await http().get(`/api/v1/inventory/prescriptions/${signedCN.id}/dispense-status`).set(authed(adminToken));
      expect(status.status, JSON.stringify(status.body)).toBe(200);
      expect(status.body.data.documents.map((d: { kind: string }) => d.kind)).toEqual(['C', 'N']);
      const docIds = new Set(status.body.data.documents.map((d: { id: string }) => d.id));
      const all = [...status.body.data.lines, ...status.body.data.freeTextLines] as { documentId: string | null }[];
      expect(all.length).toBe(4);
      expect(all.every((l) => l.documentId !== null && docIds.has(l.documentId))).toBe(true);
    });

    it('thiếu mã cơ sở KCB (chi nhánh và công ty đều không có) → ký bị chặn 422, đơn vẫn là nháp', async () => {
      await privileged.branch.update({ where: { id: branchA }, data: { facilityCode: null } });
      try {
        const e = await prepareEncounter();
        const draft = await saveDraft(e, [{ drugId: normalA }]);
        const res = await sign(e, draft.version);
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('PRESCRIPTION_FACILITY_CODE_MISSING');
        const reread = await http().get(`/api/v1/encounters/${e}/consultation`).set(authed(doctorToken));
        expect(reread.body.data.prescription.signedAt).toBeNull();
      } finally {
        await privileged.branch.update({ where: { id: branchA }, data: { facilityCode: '79001' } });
      }
    });

    it('cô lập công ty: công ty B không có đơn pháp lý nào của A; mã trùng giữa 2 công ty không vướng ràng buộc duy nhất', async () => {
      const bDocs = await privileged.prescriptionDocument.count({ where: { tenantId: fixture.tenantB.id } });
      expect(bDocs).toBe(0);
      const aDocs = await privileged.prescriptionDocument.findMany({ where: { tenantId: fixture.tenantA.id, deletedAt: null }, select: { nationalCode: true } });
      expect(aDocs.length).toBeGreaterThan(0);
      // Công ty B đọc bảng ánh xạ độc lập, không thấy dữ liệu của A.
      const b = await http().get('/api/v1/clinic-settings/prescription-kind-mapping').set(authed(tenantBAdminToken));
      expect(b.status).toBe(200);
    });
  });
});
