import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { STORAGE_PORT, getVietnamDateString, type StoragePort } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { seedClsResult } from '../../testing/cls-result-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — tab "Hình ảnh & Tài liệu", GIAI ĐOẠN 2 (docs/DECISIONS.md #299 bổ sung 3): tự gộp ảnh/PDF của kết quả cận lâm sàng ĐÃ DUYỆT, ảnh thẻ BHYT và ảnh đại diện vào tab
 * dưới dạng dòng THAM CHIẾU chỉ đọc (cùng khoá lưu, không nhân đôi tệp). Máy chủ tự đối chiếu với nguồn mỗi lần mở trang đầu: thêm dòng thiếu, cập nhật dòng đổi nguồn, gỡ mềm
 * dòng mất nguồn. Kiểm: chỉ kết quả đã duyệt, một tệp dùng chung một dòng, idempotent, đồng thời, đính chính, công tắc BHYT, người đặt ảnh + ngày từ nhật ký, phân quyền theo nhóm,
 * cô lập công ty khác + chi nhánh, gộp hồ sơ.
 */
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-test-image-bytes')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-test-bytes-xx')]);

interface ListedDoc {
  id: string;
  category: string;
  source: string;
  readOnly: boolean;
  displayName: string;
  fileName: string;
  contentType: string;
  kind: string;
  sizeBytes: number;
  sourceLabel: string | null;
  sourceRef: { orderItemId: string; encounterId: string; group: string } | null;
  encounterId: string | null;
  uploadDate: string;
  uploadedByName: string;
  branchId: string;
  branchName: string | null;
  url: string;
}

describe('HTTP e2e — Hình ảnh & Tài liệu: dòng tham chiếu tự gộp (#299 giai đoạn 2)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  let storage: StoragePort;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let branchA: string;
  let branchB: string;
  let adminToken: string;
  let branchBAdminToken: string;
  let receptionistToken: string;
  let doctorToken: string;
  let doctorId: string;
  let tenantBAdminToken: string;

  async function createPatient() {
    const res = await http()
      .post('/api/v1/patients')
      .set(authed(adminToken))
      .send({ fullName: 'Bệnh nhân tham chiếu', dob: '1990-01-01', gender: 'female', phone: '0933444555', nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999).toString() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { id: string };
  }

  const list = (token: string, patientId: string, query = '') => http().get(`/api/v1/patients/${patientId}/documents${query}`).set(authed(token));

  async function listOk(token: string, patientId: string) {
    const res = await list(token, patientId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { items: ListedDoc[]; summary: { total: number; totalBytes: number; byCategory: { category: string; count: number; totalBytes: number }[] }; multiBranch: boolean; currentBranchId: string };
  }

  const cls = (patientId: string, over: Partial<Parameters<typeof seedClsResult>[1]> & { images: Parameters<typeof seedClsResult>[1]['images'] }) =>
    seedClsResult(privileged, { tenantId: fixture.tenantA.id, branchId: branchA, patientId, serviceName: 'Siêu âm ổ bụng', ...over });

  const referenceRows = (patientId: string, deleted = false) =>
    privileged.patientDocument.findMany({ where: { patientId, sourceType: { not: 'UPLOAD' }, deletedAt: deleted ? { not: null } : null }, orderBy: { createdAt: 'asc' } });

  async function setInsurance(enabled: boolean) {
    const existing = await privileged.tenantSetting.findFirst({ where: { tenantId: fixture.tenantA.id, key: 'insurance_enabled' } });
    if (existing) await privileged.tenantSetting.update({ where: { id: existing.id }, data: { valueJson: enabled } });
    else await privileged.tenantSetting.create({ data: { tenantId: fixture.tenantA.id, key: 'insurance_enabled', valueJson: enabled, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    storage = app.get<StoragePort>(STORAGE_PORT);

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();

    fixture = await createTwoTenantFixture(privileged, 'Patient document reference e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    branchA = (await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true }, select: { id: true } })).id;
    branchB = (
      await privileged.branch.create({
        data: { tenantId: fixture.tenantA.id, code: 'CN00002', name: 'Chi nhánh B (tham chiếu)', isDefault: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      })
    ).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'ref-admin', [branchA]);
    const adminB = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'ref-adminB', [branchB]);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'ref-recep', [branchA]);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'ref-doctor', [branchA]);
    const tenantBAdmin = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'ref-adminTB', []);
    doctorId = doctor.id;
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    branchBAdminToken = await h.login(fixture.tenantA.id, adminB.username);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    tenantBAdminToken = await h.login(fixture.tenantB.id, tenantBAdmin.username);
  });

  afterAll(async () => {
    await setInsurance(false).catch(() => undefined);
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('kết quả cận lâm sàng', () => {
    it('chỉ kết quả ĐÃ DUYỆT mới hiện; dòng chỉ đọc, đúng loại, tên dịch vụ, lượt khám, người tải và tổng quan', async () => {
      const patient = await createPatient();
      const signed = await cls(patient.id, {
        images: [
          { storageKey: `paraclinical/${randomUUID()}/a.jpg`, fileName: 'sieu-am-1.jpg', sizeBytes: 2000, createdBy: doctorId },
          { storageKey: `paraclinical/${randomUUID()}/b.jpg`, fileName: 'sieu-am-2.jpg', sizeBytes: 3000, createdBy: doctorId },
        ],
      });
      const draftKey = `paraclinical/${randomUUID()}/draft.jpg`;
      await cls(patient.id, { serviceName: 'X-quang ngực', images: [{ storageKey: draftKey }], signed: false });

      const res = await listOk(adminToken, patient.id);
      expect(res.items).toHaveLength(2);
      expect(res.items.map((i) => i.fileName).sort()).toEqual(['sieu-am-1.jpg', 'sieu-am-2.jpg']);
      for (const item of res.items) {
        expect(item).toMatchObject({
          source: 'PARACLINICAL_IMAGE',
          readOnly: true,
          category: 'PARACLINICAL',
          kind: 'image',
          sourceLabel: 'Siêu âm ổ bụng',
          sourceRef: { orderItemId: signed.orderItemId, encounterId: signed.encounterId, group: 'imaging' },
          encounterId: signed.encounterId,
          uploadedByName: 'User ref-doctor',
          uploadDate: getVietnamDateString(new Date()),
        });
      }
      expect(res.summary.total).toBe(2);
      expect(res.summary.totalBytes).toBe(5000);
      expect(res.summary.byCategory.find((c) => c.category === 'PARACLINICAL')).toMatchObject({ count: 2, totalBytes: 5000 });
      expect(JSON.stringify(res.items)).not.toContain(draftKey);
      // Dòng tham chiếu dùng ĐÚNG khoá lưu của ảnh gốc (không nhân đôi tệp) và nhớ ảnh nguồn.
      const rows = await referenceRows(patient.id);
      expect(rows).toHaveLength(2);
      const sources = await privileged.paraclinicalResultImage.findMany({ where: { id: { in: signed.imageIds } } });
      expect(rows.map((r) => r.storageKey).sort()).toEqual(sources.map((s) => s.storageKey).sort());
      expect(rows.map((r) => r.sourceId).sort()).toEqual([...signed.imageIds].sort());
    });

    it('PDF kết quả xét nghiệm (đối tác) hiện dạng PDF và mở bằng nhóm "lab"', async () => {
      const patient = await createPatient();
      await cls(patient.id, {
        serviceName: 'Công thức máu',
        serviceKind: 'LAB',
        images: [{ storageKey: `lab-partner/${randomUUID()}.pdf`, fileName: 'ket-qua-doi-tac.pdf', contentType: 'application/pdf', sizeBytes: 400_000 }],
      });
      const [item] = (await listOk(adminToken, patient.id)).items;
      expect(item).toMatchObject({ kind: 'pdf', contentType: 'application/pdf', sourceLabel: 'Công thức máu', category: 'PARACLINICAL' });
      expect(item!.sourceRef!.group).toBe('lab');
    });

    it('một PDF gắn cho nhiều dịch vụ của cùng bệnh nhân chỉ hiện MỘT dòng (dịch vụ cũ nhất đại diện)', async () => {
      const patient = await createPatient();
      const sharedKey = `lab-partner/${randomUUID()}.pdf`;
      const pdf = { storageKey: sharedKey, fileName: 'ket-qua.pdf', contentType: 'application/pdf', sizeBytes: 5000 };
      await cls(patient.id, { serviceName: 'Công thức máu', serviceKind: 'LAB', images: [pdf] });
      await cls(patient.id, { serviceName: 'Đường huyết', serviceKind: 'LAB', images: [pdf] });
      await cls(patient.id, { serviceName: 'Men gan', serviceKind: 'LAB', images: [pdf] });

      const res = await listOk(adminToken, patient.id);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]!.sourceLabel).toBe('Công thức máu');
      expect(res.summary.total).toBe(1);
      expect(await referenceRows(patient.id)).toHaveLength(1);
    });

    it('mở tab nhiều lần không ghi thêm gì (idempotent): số dòng, phiên bản và giờ sửa giữ nguyên', async () => {
      const patient = await createPatient();
      await cls(patient.id, { images: [{ storageKey: `paraclinical/${randomUUID()}/a.jpg` }, { storageKey: `paraclinical/${randomUUID()}/b.jpg` }] });
      await listOk(adminToken, patient.id);
      const before = await referenceRows(patient.id);
      await listOk(adminToken, patient.id);
      await listOk(doctorToken, patient.id);
      const after = await referenceRows(patient.id);
      expect(after.map((r) => [r.id, r.version, r.updatedAt.toISOString()])).toEqual(before.map((r) => [r.id, r.version, r.updatedAt.toISOString()]));
    });

    it('nhiều người mở tab cùng lúc cho hồ sơ chưa từng mở: không lỗi, mỗi tệp chỉ có đúng một dòng', async () => {
      const patient = await createPatient();
      await cls(patient.id, { images: [{ storageKey: `paraclinical/${randomUUID()}/a.jpg` }, { storageKey: `paraclinical/${randomUUID()}/b.jpg` }] });
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => list(adminToken, patient.id)));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(await referenceRows(patient.id)).toHaveLength(2);
      expect(await listOk(adminToken, patient.id).then((r) => r.items.length)).toBe(2);
    });

    it('kết quả đang đính chính (bản gốc xoá mềm) thì dòng biến mất; ký lại thì quay lại', async () => {
      const patient = await createPatient();
      const seeded = await cls(patient.id, { images: [{ storageKey: `paraclinical/${randomUUID()}/a.jpg` }, { storageKey: `paraclinical/${randomUUID()}/b.jpg` }] });
      expect((await listOk(adminToken, patient.id)).items).toHaveLength(2);

      // Đính chính: bản gốc đã ký bị xoá mềm (bản nháp mới chưa ký) → chưa có kết quả hiệu lực nào để hiện.
      await privileged.paraclinicalResult.update({ where: { id: seeded.resultId }, data: { deletedAt: new Date(), deletedReason: 'Đính chính: test' } });
      expect((await listOk(adminToken, patient.id)).items).toHaveLength(0);
      const removed = await referenceRows(patient.id, true);
      expect(removed).toHaveLength(2);
      expect(removed.every((r) => r.deletedReason === 'source_removed')).toBe(true);

      // Ký lại bản đính chính → hiện lại (dòng mới, dòng cũ vẫn là lịch sử đã gỡ).
      await privileged.paraclinicalResult.update({ where: { id: seeded.resultId }, data: { deletedAt: null, deletedReason: null } });
      expect((await listOk(adminToken, patient.id)).items).toHaveLength(2);
      // Ảnh của kết quả đã ký không gỡ được (trigger DB chặn, phải đính chính) nên không có ca "gỡ một ảnh" ở bản đã ký; ảnh của bản nháp thì không hiện ở tab.
    });
  });

  describe('thẻ BHYT và ảnh đại diện', () => {
    it('ảnh thẻ BHYT: công tắc tắt thì không hiện; bật thì hiện hai mặt (loại Hợp đồng và giấy tờ, dung lượng thật, người đặt + ngày lấy từ nhật ký); tắt lại thì gỡ', async () => {
      const patient = await createPatient();
      const frontKey = `patient/${patient.id}/insurance/x/front/${randomUUID()}.jpg`;
      const backKey = `patient/${patient.id}/insurance/x/back/${randomUUID()}.png`;
      await storage.save(fixture.tenantA.id, frontKey, JPG, 'image/jpeg');
      await storage.save(fixture.tenantA.id, backKey, PNG, 'image/png');
      const card = await privileged.insuranceCard.create({
        data: {
          tenantId: fixture.tenantA.id,
          patientId: patient.id,
          cardNoEnc: Buffer.from('x'),
          cardNoHash: randomUUID(),
          photoFrontKey: frontKey,
          photoBackKey: backKey,
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });
      const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
      await privileged.auditLog.create({
        data: { tenantId: fixture.tenantA.id, actorId: doctorId, action: 'insurance_card.photo_updated', entityType: 'insurance_card', entityId: card.id, afterJson: { patientId: patient.id, side: 'front' }, occurredAt: threeDaysAgo },
      });

      try {
        await setInsurance(false);
        expect((await listOk(adminToken, patient.id)).items).toHaveLength(0);

        await setInsurance(true);
        const res = await listOk(adminToken, patient.id);
        expect(res.items).toHaveLength(2);
        const front = res.items.find((i) => i.displayName === 'Thẻ BHYT - mặt trước.jpg')!;
        const back = res.items.find((i) => i.displayName === 'Thẻ BHYT - mặt sau.png')!;
        expect(front).toMatchObject({ source: 'INSURANCE_CARD', readOnly: true, category: 'CONTRACT', sizeBytes: JPG.byteLength, contentType: 'image/jpeg', uploadedByName: 'User ref-doctor', sourceLabel: null, sourceRef: null });
        expect(front.uploadDate).toBe(getVietnamDateString(threeDaysAgo));
        expect(back).toMatchObject({ category: 'CONTRACT', sizeBytes: PNG.byteLength, contentType: 'image/png' });
        // Ảnh thẻ đi theo hồ sơ, không thuộc chi nhánh nào: không tên chi nhánh, không bị tô "chi nhánh khác".
        expect(front.branchName).toBeNull();
        expect(front.branchId).toBe(res.currentBranchId);
        // Người xem làm việc ở chi nhánh B (chi nhánh mặc định là A): ảnh thẻ vẫn không thuộc chi nhánh nào, không bị tô "chi nhánh khác".
        const asBranchB = await listOk(branchBAdminToken, patient.id);
        expect(asBranchB.currentBranchId).toBe(branchB);
        expect(asBranchB.items.map((i) => [i.branchId, i.branchName])).toEqual([[branchB, null], [branchB, null]]);
        // Tệp mở được qua đường dẫn ký — cùng khoá lưu với tệp gốc, không nhân đôi.
        const file = await http().get(front.url);
        expect(file.status).toBe(200);
        expect(file.headers['content-type']).toContain('image/jpeg');

        await setInsurance(false);
        expect((await listOk(adminToken, patient.id)).items).toHaveLength(0);
        expect(await referenceRows(patient.id)).toHaveLength(0);
      } finally {
        await setInsurance(false);
      }
    });

    it('ảnh thẻ mà tệp gốc không còn trong kho thì bỏ qua, không lỗi 500; thẻ bị xoá mềm thì ảnh biến mất', async () => {
      const patient = await createPatient();
      const savedKey = `patient/${patient.id}/insurance/y/front/${randomUUID()}.jpg`;
      await storage.save(fixture.tenantA.id, savedKey, JPG, 'image/jpeg');
      const card = await privileged.insuranceCard.create({
        data: {
          tenantId: fixture.tenantA.id,
          patientId: patient.id,
          cardNoEnc: Buffer.from('x'),
          cardNoHash: randomUUID(),
          photoFrontKey: savedKey,
          photoBackKey: `patient/${patient.id}/insurance/y/back/${randomUUID()}.jpg`, // chưa từng lưu vào kho
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });
      try {
        await setInsurance(true);
        const res = await listOk(adminToken, patient.id);
        expect(res.items.map((i) => i.displayName)).toEqual(['Thẻ BHYT - mặt trước.jpg']);

        await privileged.insuranceCard.update({ where: { id: card.id }, data: { deletedAt: new Date(), deletedReason: 'xoá thẻ' } });
        expect((await listOk(adminToken, patient.id)).items).toHaveLength(0);
      } finally {
        await setInsurance(false);
      }
    });

    it('ảnh đại diện hiện loại "Khác", đổi ảnh thì dòng cũ được thay bằng dòng mới (không nhân đôi)', async () => {
      const patient = await createPatient();
      const first = `patient/${patient.id}/photo/${randomUUID()}.jpg`;
      await storage.save(fixture.tenantA.id, first, JPG, 'image/jpeg');
      await privileged.patient.update({ where: { id: patient.id }, data: { photoKey: first } });

      const one = await listOk(adminToken, patient.id);
      expect(one.items).toHaveLength(1);
      expect(one.items[0]).toMatchObject({ source: 'PATIENT_PHOTO', readOnly: true, category: 'OTHER', displayName: 'Ảnh đại diện.jpg', sizeBytes: JPG.byteLength, branchName: null });

      const second = `patient/${patient.id}/photo/${randomUUID()}.png`;
      await storage.save(fixture.tenantA.id, second, PNG, 'image/png');
      await privileged.patient.update({ where: { id: patient.id }, data: { photoKey: second } });
      const two = await listOk(adminToken, patient.id);
      expect(two.items).toHaveLength(1);
      expect(two.items[0]).toMatchObject({ displayName: 'Ảnh đại diện.png', sizeBytes: PNG.byteLength, contentType: 'image/png' });
      expect((await referenceRows(patient.id)).map((r) => r.storageKey)).toEqual([second]);
    });
  });

  describe('phân quyền và cô lập', () => {
    it('lễ tân (chỉ nhóm hợp đồng và giấy tờ) thấy ảnh thẻ BHYT nhưng KHÔNG thấy kết quả cận lâm sàng lẫn tổng quan của chúng', async () => {
      const patient = await createPatient();
      await cls(patient.id, { images: [{ storageKey: `paraclinical/${randomUUID()}/a.jpg`, sizeBytes: 7777 }] });
      const frontKey = `patient/${patient.id}/insurance/z/front/${randomUUID()}.jpg`;
      await storage.save(fixture.tenantA.id, frontKey, JPG, 'image/jpeg');
      await privileged.insuranceCard.create({
        data: { tenantId: fixture.tenantA.id, patientId: patient.id, cardNoEnc: Buffer.from('x'), cardNoHash: randomUUID(), photoFrontKey: frontKey, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      });
      try {
        await setInsurance(true);
        const asReception = await listOk(receptionistToken, patient.id);
        expect(asReception.items.map((i) => i.source)).toEqual(['INSURANCE_CARD']);
        expect(asReception.summary.total).toBe(1);
        expect(asReception.summary.byCategory.map((c) => c.category)).toEqual(['CONTRACT']);

        const asAdmin = await listOk(adminToken, patient.id);
        expect(asAdmin.items.map((i) => i.source).sort()).toEqual(['INSURANCE_CARD', 'PARACLINICAL_IMAGE']);
      } finally {
        await setInsurance(false);
      }
    });

    it('kết quả của bệnh nhân khác không lẫn sang; công ty khác không mở được hồ sơ (404)', async () => {
      const mine = await createPatient();
      const other = await createPatient();
      await cls(mine.id, { serviceName: 'Của tôi', images: [{ storageKey: `paraclinical/${randomUUID()}/mine.jpg` }] });
      await cls(other.id, { serviceName: 'Của người khác', images: [{ storageKey: `paraclinical/${randomUUID()}/other.jpg` }] });

      expect((await listOk(adminToken, mine.id)).items.map((i) => i.sourceLabel)).toEqual(['Của tôi']);
      expect((await listOk(adminToken, other.id)).items.map((i) => i.sourceLabel)).toEqual(['Của người khác']);

      const crossTenant = await list(tenantBAdminToken, mine.id);
      expect(crossTenant.status).toBe(404);
      expect(await privileged.patientDocument.count({ where: { patientId: mine.id, tenantId: fixture.tenantB.id } })).toBe(0);
    });

    it('kết quả làm ở CHI NHÁNH KHÁC vẫn hiện (tệp đi theo bệnh nhân) kèm tên chi nhánh đó; công ty có từ 2 chi nhánh bật cờ multiBranch', async () => {
      const patient = await createPatient();
      await cls(patient.id, { branchId: branchB, images: [{ storageKey: `paraclinical/${randomUUID()}/b.jpg` }] });
      const res = await listOk(doctorToken, patient.id); // bác sĩ chỉ được gán chi nhánh A
      expect(res.multiBranch).toBe(true);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({ branchId: branchB, branchName: 'Chi nhánh B (tham chiếu)' });
      expect(res.currentBranchId).toBe(branchA);
    });

    it('trang sau (có con trỏ) không đối chiếu lại nguồn — chỉ trang đầu mới đối chiếu', async () => {
      const patient = await createPatient();
      await cls(patient.id, { images: [{ storageKey: `paraclinical/${randomUUID()}/a.jpg` }, { storageKey: `paraclinical/${randomUUID()}/b.jpg` }] });
      const first = await http().get(`/api/v1/patients/${patient.id}/documents?limit=1`).set(authed(adminToken));
      expect(first.status).toBe(200);
      expect(first.body.data.items).toHaveLength(1);
      const cursor = first.body.data.nextCursor as string;
      expect(cursor).toBeTruthy();
      // Nguồn đổi giữa hai trang (kết quả bị xoá mềm): trang kế tiếp vẫn là dữ liệu của lần đối chiếu đầu — không gỡ dòng giữa chừng làm trang bị thiếu/lệch.
      const rowsBefore = await referenceRows(patient.id);
      await privileged.paraclinicalResult.updateMany({ where: { orderItem: { order: { encounter: { patientId: patient.id } } } }, data: { deletedAt: new Date(), deletedReason: 'test' } });
      const second = await http().get(`/api/v1/patients/${patient.id}/documents?limit=1&cursor=${encodeURIComponent(cursor)}`).set(authed(adminToken));
      expect(second.status).toBe(200);
      expect(second.body.data.items).toHaveLength(1);
      expect(second.body.data.items[0].id).not.toBe(first.body.data.items[0].id);
      expect((await referenceRows(patient.id)).map((r) => r.id)).toEqual(rowsBefore.map((r) => r.id));
    });
  });

  describe('gộp hồ sơ', () => {
    it('gộp hồ sơ khi cả hai bên cùng có dòng trỏ MỘT tệp dùng chung: không lỗi, hồ sơ đích còn đúng một dòng, dòng của hồ sơ nguồn được gỡ mềm', async () => {
      const source = await createPatient();
      const target = await createPatient();
      const sharedKey = `lab-partner/${randomUUID()}.pdf`;
      const pdf = { storageKey: sharedKey, fileName: 'chung.pdf', contentType: 'application/pdf' };
      await cls(source.id, { serviceName: 'Xét nghiệm nguồn', serviceKind: 'LAB', images: [pdf] });
      await cls(target.id, { serviceName: 'Xét nghiệm đích', serviceKind: 'LAB', images: [pdf] });
      expect((await listOk(adminToken, source.id)).items).toHaveLength(1);
      expect((await listOk(adminToken, target.id)).items).toHaveLength(1);

      const merged = await http().post('/api/v1/patients/merge').set(authed(adminToken)).send({ sourceId: source.id, targetId: target.id });
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);

      expect(await referenceRows(source.id)).toHaveLength(0);
      const after = await listOk(adminToken, target.id);
      // Lượt khám của hồ sơ nguồn đã chuyển sang đích; cùng một PDF nên vẫn chỉ MỘT dòng.
      expect(after.items.filter((i) => i.source === 'PARACLINICAL_IMAGE')).toHaveLength(1);
      expect((await referenceRows(target.id)).filter((r) => r.storageKey === sharedKey)).toHaveLength(1);
    });
  });
});
