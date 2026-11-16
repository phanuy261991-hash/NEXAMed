import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { STORAGE_PORT, type StoragePort } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { seedClsResult } from '../../testing/cls-result-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — tab "Hình ảnh & Tài liệu", GIAI ĐOẠN 3 (docs/DECISIONS.md #299 bổ sung 4): công tắc "Dùng Hình ảnh & Tài liệu" (tắt thì máy chủ từ chối mọi API của tab, 409),
 * dung lượng đã dùng của cả công ty ở Cấu hình chung, và ảnh thu nhỏ do trình duyệt gửi kèm lúc tải lên (chỉ nhận JPEG nhỏ cho tệp ảnh, không đạt thì bỏ qua, không để rác khi lỗi).
 */
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-main-image-bytes-0123456789')]);
const THUMB = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-thumb')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-test-bytes-xx')]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');

describe('HTTP e2e — Hình ảnh & Tài liệu: công tắc, dung lượng, ảnh thu nhỏ (#299 giai đoạn 3)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  let storage: StoragePort;
  let storageDir: string;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let branchA: string;
  let adminToken: string;
  let receptionistToken: string;
  let doctorToken: string;
  let tenantBAdminToken: string;

  async function createPatient(token = adminToken) {
    const res = await http()
      .post('/api/v1/patients')
      .set(authed(token))
      .send({ fullName: 'Bệnh nhân giai đoạn 3', dob: '1990-01-01', gender: 'female', phone: '0933444555', nationalId: '079' + Math.floor(100000000 + Math.random() * 899999999).toString() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { id: string };
  }

  function upload(token: string, patientId: string, file: Buffer, filename: string, thumbnail?: Buffer, category = 'CLINICAL_PHOTO') {
    let req = http().post(`/api/v1/patients/${patientId}/documents`).set(authed(token)).field('category', category).attach('file', file, { filename });
    if (thumbnail) req = req.attach('thumbnail', thumbnail, { filename: 'thumb.jpg' });
    return req;
  }

  async function uploadOk(patientId: string, file: Buffer, filename: string, thumbnail?: Buffer, category = 'CLINICAL_PHOTO') {
    const res = await upload(adminToken, patientId, file, filename, thumbnail, category);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { id: string; version: number; url: string; thumbnailUrl: string | null; kind: string };
  }

  const setToggle = (token: string, enabled: boolean) => http().patch('/api/v1/clinic-settings').set(authed(token)).send({ patientDocumentsEnabled: enabled });
  const usage = (token = adminToken) => http().get('/api/v1/patient-documents/usage').set(authed(token));
  async function usageOk(token = adminToken) {
    const res = await usage(token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { fileCount: number; totalBytes: number; volumeTotalBytes: number | null; volumeFreeBytes: number | null };
  }
  const docFiles = async (tenantId: string, patientId: string) => {
    try {
      return await readdir(join(storageDir, tenantId, 'patient', patientId, 'documents'));
    } catch {
      return [];
    }
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    storage = app.get<StoragePort>(STORAGE_PORT);
    storageDir = app.get(ConfigService).getOrThrow<string>('STORAGE_DIR');

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();

    fixture = await createTwoTenantFixture(privileged, 'Patient document settings e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = (await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true }, select: { id: true } })).id;

    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'set-admin', [branchA]);
    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'set-recep', [branchA]);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'set-doctor', [branchA]);
    const adminB = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'set-adminTB', []);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    tenantBAdminToken = await h.login(fixture.tenantB.id, adminB.username);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('công tắc "Dùng Hình ảnh & Tài liệu"', () => {
    it('mặc định BẬT; mọi nhân viên đọc được trạng thái; chỉ người có clinic_config.update đổi được', async () => {
      for (const token of [adminToken, receptionistToken, doctorToken]) {
        const res = await http().get('/api/v1/clinic-settings/patient-documents-enabled').set(authed(token));
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ enabled: true });
      }
      const settings = await http().get('/api/v1/clinic-settings').set(authed(adminToken));
      expect(settings.body.data.patientDocumentsEnabled).toBe(true);

      const denied = await setToggle(receptionistToken, false);
      expect(denied.status).toBe(403);
      expect((await http().get('/api/v1/clinic-settings/patient-documents-enabled').set(authed(adminToken))).body.data.enabled).toBe(true);
    });

    it('TẮT: mọi API của tab trả 409 PATIENT_DOCUMENTS_DISABLED (danh sách, tải lên, sửa, xoá, thư mục); tệp đã tải giữ nguyên, bật lại là thấy đủ; công ty khác không bị ảnh hưởng', async () => {
      const patient = await createPatient();
      const doc = await uploadOk(patient.id, JPG, 'truoc-khi-tat.jpg');
      const folder = (await http().post(`/api/v1/patients/${patient.id}/documents/folders`).set(authed(adminToken)).send({ name: 'Thư mục thử' })).body.data as { id: string; version: number };
      const patientB = await createPatient(tenantBAdminToken);

      expect((await setToggle(adminToken, false)).status).toBe(200);
      try {
        expect((await http().get('/api/v1/clinic-settings/patient-documents-enabled').set(authed(receptionistToken))).body.data.enabled).toBe(false);
        const base = `/api/v1/patients/${patient.id}/documents`;
        const calls = [
          http().get(base).set(authed(adminToken)),
          http().get(`${base}/encounter-options`).set(authed(adminToken)),
          upload(adminToken, patient.id, JPG, 'khi-tat.jpg'),
          http().patch(`${base}/${doc.id}`).set(authed(adminToken)).send({ note: 'x', version: doc.version }),
          http().delete(`${base}/${doc.id}?reason=thu&version=${doc.version}`).set(authed(adminToken)),
          http().post(`${base}/folders`).set(authed(adminToken)).send({ name: 'Mới' }),
          http().patch(`${base}/folders/${folder.id}`).set(authed(adminToken)).send({ name: 'Đổi', version: folder.version }),
          http().delete(`${base}/folders/${folder.id}?version=${folder.version}`).set(authed(adminToken)),
        ];
        for (const res of await Promise.all(calls)) {
          expect(res.status, JSON.stringify(res.body)).toBe(409);
          expect(res.body.error.code).toBe('PATIENT_DOCUMENTS_DISABLED');
          expect(res.body.error.message).toContain('Hình ảnh & Tài liệu');
        }
        // Tệp đã tải không bị đụng tới (không xoá, không đổi): chỉ API của tab bị chặn.
        const row = await privileged.patientDocument.findUniqueOrThrow({ where: { id: doc.id } });
        expect(row.deletedAt).toBeNull();
        expect(row.version).toBe(doc.version);
        expect(await privileged.patientDocument.count({ where: { patientId: patient.id } })).toBe(1);
        // Đường dẫn ký của tệp cũ vẫn mở được (kho tệp không thuộc API của tab); số liệu dung lượng vẫn đọc được để lo ổ đĩa.
        expect((await http().get(doc.url)).status).toBe(200);
        expect((await usage()).status).toBe(200);
        // Công ty khác dùng bình thường.
        expect((await http().get(`/api/v1/patients/${patientB.id}/documents`).set(authed(tenantBAdminToken))).status).toBe(200);
      } finally {
        expect((await setToggle(adminToken, true)).status).toBe(200);
      }
      const back = await http().get(`/api/v1/patients/${patient.id}/documents`).set(authed(adminToken));
      expect(back.status).toBe(200);
      expect(back.body.data.items.map((i: { id: string }) => i.id)).toEqual([doc.id]);
    });
  });

  describe('dung lượng đã dùng', () => {
    it('chỉ người có clinic_config.read xem được (lễ tân 403); công ty khác chỉ thấy số của mình', async () => {
      expect((await usage(receptionistToken)).status).toBe(403);
      expect((await usage(doctorToken)).status).toBe(403);
      const b = await usageOk(tenantBAdminToken);
      expect(b).toMatchObject({ fileCount: 0, totalBytes: 0 });
    });

    it('cộng đủ 4 nguồn, mỗi tệp gốc một lần; tệp thiếu trong kho không tính; tệp xoá mềm vẫn tính; ảnh thu nhỏ cộng byte nhưng không cộng số tệp', async () => {
      const before = await usageOk();
      const patient = await createPatient();

      // 1) Tệp tải tay (ảnh + PDF).
      await uploadOk(patient.id, JPG, 'a.jpg');
      const pdf = await uploadOk(patient.id, PDF, 'b.pdf', undefined, 'CONTRACT');
      const afterUploads = await usageOk();
      expect(afterUploads.fileCount - before.fileCount).toBe(2);
      expect(afterUploads.totalBytes - before.totalBytes).toBe(JPG.byteLength + PDF.byteLength);

      // 2) Ảnh/PDF kết quả cận lâm sàng: một PDF dùng chung cho 2 dịch vụ chỉ tính một lần, thêm một ảnh riêng.
      const shared = `lab-partner/${randomUUID()}.pdf`;
      await seedClsResult(privileged, { tenantId: fixture.tenantA.id, branchId: branchA, patientId: patient.id, serviceName: 'Công thức máu', serviceKind: 'LAB', images: [{ storageKey: shared, contentType: 'application/pdf', sizeBytes: 1000 }] });
      await seedClsResult(privileged, { tenantId: fixture.tenantA.id, branchId: branchA, patientId: patient.id, serviceName: 'Men gan', serviceKind: 'LAB', images: [{ storageKey: shared, contentType: 'application/pdf', sizeBytes: 1000 }] });
      await seedClsResult(privileged, { tenantId: fixture.tenantA.id, branchId: branchA, patientId: patient.id, serviceName: 'Siêu âm', images: [{ storageKey: `paraclinical/${randomUUID()}/x.jpg`, sizeBytes: 500 }] });
      const afterCls = await usageOk();
      expect(afterCls.fileCount - afterUploads.fileCount).toBe(2);
      expect(afterCls.totalBytes - afterUploads.totalBytes).toBe(1500);

      // 3) Ảnh thẻ BHYT (mặt sau không còn trong kho) + 4) ảnh đại diện: dung lượng đo từ kho.
      const front = `patient/${patient.id}/insurance/x/front/${randomUUID()}.jpg`;
      await storage.save(fixture.tenantA.id, front, JPG, 'image/jpeg');
      await privileged.insuranceCard.create({
        data: {
          tenantId: fixture.tenantA.id,
          patientId: patient.id,
          cardNoEnc: Buffer.from('x'),
          cardNoHash: randomUUID(),
          photoFrontKey: front,
          photoBackKey: `patient/${patient.id}/insurance/x/back/${randomUUID()}.jpg`,
          createdBy: SYSTEM_TEST_ACTOR,
          updatedBy: SYSTEM_TEST_ACTOR,
        },
      });
      const avatar = `patient/${patient.id}/photo/${randomUUID()}.png`;
      await storage.save(fixture.tenantA.id, avatar, PNG, 'image/png');
      await privileged.patient.update({ where: { id: patient.id }, data: { photoKey: avatar } });
      const afterPhotos = await usageOk();
      expect(afterPhotos.fileCount - afterCls.fileCount).toBe(2);
      expect(afterPhotos.totalBytes - afterCls.totalBytes).toBe(JPG.byteLength + PNG.byteLength);

      // Xoá mềm tệp tải tay: tệp vẫn nằm trên đĩa nên vẫn tính.
      expect((await http().delete(`/api/v1/patients/${patient.id}/documents/${pdf.id}?reason=thu&version=${pdf.version}`).set(authed(adminToken))).status).toBe(200);
      const afterDelete = await usageOk();
      expect(afterDelete.fileCount).toBe(afterPhotos.fileCount);
      expect(afterDelete.totalBytes).toBe(afterPhotos.totalBytes);

      // Ảnh thu nhỏ: cộng byte của ảnh thu nhỏ, số tệp chỉ tăng 1 (tệp chính).
      await uploadOk(patient.id, JPG, 'c.jpg', THUMB);
      const afterThumb = await usageOk();
      expect(afterThumb.fileCount - afterDelete.fileCount).toBe(1);
      expect(afterThumb.totalBytes - afterDelete.totalBytes).toBe(JPG.byteLength + THUMB.byteLength);

      // Thông tin ổ chứa kho để vẽ thanh phần trăm.
      expect(afterThumb.volumeTotalBytes).toBeGreaterThan(0);
      expect(afterThumb.volumeFreeBytes).toBeLessThanOrEqual(afterThumb.volumeTotalBytes as number);

      // Công ty khác vẫn không thấy gì của công ty này dù công ty này đã có đủ 4 nguồn tệp.
      expect(await usageOk(tenantBAdminToken)).toMatchObject({ fileCount: 0, totalBytes: 0 });
    });
  });

  describe('ảnh thu nhỏ', () => {
    it('tải ảnh kèm ảnh thu nhỏ JPEG: lưu cạnh tệp gốc, trả thumbnailUrl mở được, danh sách cũng có', async () => {
      const patient = await createPatient();
      const doc = await uploadOk(patient.id, JPG, 'co-thumb.jpg', THUMB);
      expect(doc.thumbnailUrl).toMatch(/^\/api\/v1\/files\//);
      const file = await http().get(doc.thumbnailUrl as string);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toContain('image/jpeg');
      expect(Buffer.from(file.body).equals(THUMB)).toBe(true);

      const row = await privileged.patientDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(row.thumbKey).toBe(row.storageKey.replace(/\.jpg$/, '.thumb.jpg'));
      const listed = (await http().get(`/api/v1/patients/${patient.id}/documents`).set(authed(adminToken))).body.data.items[0];
      expect(listed.thumbnailUrl).toMatch(/^\/api\/v1\/files\//);
      expect(await docFiles(fixture.tenantA.id, patient.id)).toHaveLength(2);
    });

    it('ảnh thu nhỏ không đạt (không phải JPEG, quá 200 KB, tệp chính là PDF) bị BỎ QUA: tệp vẫn lưu, thumbnailUrl rỗng, không để rác', async () => {
      const patient = await createPatient();
      const png = await uploadOk(patient.id, JPG, 'sai-dinh-dang.jpg', PNG);
      const big = await uploadOk(patient.id, JPG, 'qua-lon.jpg', Buffer.concat([THUMB, Buffer.alloc(200 * 1024 + 1)]));
      const forPdf = await uploadOk(patient.id, PDF, 'tep-pdf.pdf', THUMB, 'CONTRACT');
      const noThumb = await uploadOk(patient.id, JPG, 'khong-thumb.jpg');
      for (const d of [png, big, forPdf, noThumb]) expect(d.thumbnailUrl).toBeNull();
      expect(await privileged.patientDocument.count({ where: { patientId: patient.id, thumbKey: { not: null } } })).toBe(0);
      expect(await docFiles(fixture.tenantA.id, patient.id)).toHaveLength(4); // đúng 4 tệp chính, không có ảnh thu nhỏ nào
    });

    it('tải lên thất bại (trùng tên) không để lại ảnh thu nhỏ trong kho', async () => {
      const patient = await createPatient();
      await uploadOk(patient.id, JPG, 'trung-ten.jpg', THUMB);
      expect(await docFiles(fixture.tenantA.id, patient.id)).toHaveLength(2);
      const dup = await upload(adminToken, patient.id, JPG, 'trung-ten.jpg', THUMB);
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('PATIENT_DOCUMENT_NAME_TAKEN');
      expect(await docFiles(fixture.tenantA.id, patient.id)).toHaveLength(2);
    });

    it('nhiều yêu cầu tải CÙNG TÊN đồng thời: chỉ một thành công, các yêu cầu thua (chỉ mục duy nhất, sau khi đã lưu tệp) dọn sạch cả tệp chính lẫn ảnh thu nhỏ', async () => {
      const patient = await createPatient();
      const results = await Promise.all(Array.from({ length: 6 }, () => upload(adminToken, patient.id, JPG, 'cung-ten.jpg', THUMB)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((x) => x === 200)).toHaveLength(1);
      expect(statuses.filter((x) => x === 409)).toHaveLength(5);
      expect(await privileged.patientDocument.count({ where: { patientId: patient.id, deletedAt: null } })).toBe(1);
      // Đúng 2 tệp trong kho (1 tệp chính + 1 ảnh thu nhỏ của yêu cầu thắng) — yêu cầu thua không để rác.
      expect(await docFiles(fixture.tenantA.id, patient.id)).toHaveLength(2);
    });

    it('dòng tham chiếu (kết quả cận lâm sàng) không có ảnh thu nhỏ — giao diện rơi về ảnh gốc', async () => {
      const patient = await createPatient();
      await seedClsResult(privileged, { tenantId: fixture.tenantA.id, branchId: branchA, patientId: patient.id, serviceName: 'Siêu âm bụng', images: [{ storageKey: `paraclinical/${randomUUID()}/y.jpg` }] });
      const [item] = (await http().get(`/api/v1/patients/${patient.id}/documents`).set(authed(adminToken))).body.data.items;
      expect(item.source).toBe('PARACLINICAL_IMAGE');
      expect(item.thumbnailUrl).toBeNull();
    });
  });
});
