import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { getVietnamDateString } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { seedClsResult } from '../../testing/cls-result-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — tab "Hình ảnh & Tài liệu" của hồ sơ bệnh nhân (docs/DECISIONS.md #299): hai nhóm quyền độc lập (tệp lâm sàng / hợp đồng và giấy tờ), kiểm magic byte,
 * dung lượng, thư mục ảo theo ngày + thư mục tự tạo, khoá lạc quan, xoá mềm kèm lý do, phân trang bằng con trỏ, cô lập công ty khác và chi nhánh khác
 * (tệp theo BỆNH NHÂN nên chung cả công ty), nhật ký không ghi tên tệp.
 */
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-test-image-bytes')]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');

describe('HTTP e2e — Hình ảnh & Tài liệu của bệnh nhân (#299)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const h = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const { http, authed } = h;

  let branchA: string;
  let branchB: string;
  let receptionistToken: string;
  let doctorToken: string;
  let doctorId: string;
  let nurseToken: string;
  let adminToken: string;
  let branchBAdminToken: string;
  let labTechToken: string;
  let tenantBAdminToken: string;

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  async function createPatient(token = adminToken) {
    const res = await http()
      .post('/api/v1/patients')
      .set(authed(token))
      .send({ fullName: 'Bệnh nhân tài liệu', dob: '1990-01-01', gender: 'female', phone: '0933444555', nationalId: randomNationalId() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { id: string };
  }

  function upload(token: string, patientId: string, category: string, file: Buffer = JPG, filename = 'anh.jpg', extra: Record<string, string> = {}) {
    let req = http().post(`/api/v1/patients/${patientId}/documents`).set(authed(token)).field('category', category);
    for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
    return req.attach('file', file, { filename });
  }

  const list = (token: string, patientId: string, query = '') => http().get(`/api/v1/patients/${patientId}/documents${query}`).set(authed(token));

  async function uploadOk(token: string, patientId: string, category: string, file: Buffer = JPG, filename = 'anh.jpg', extra: Record<string, string> = {}) {
    const res = await upload(token, patientId, category, file, filename, extra);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { id: string; version: number; url: string; folderName: string | null; uploadDate: string; displayName: string; encounterLabel: string | null; branchId: string };
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

    fixture = await createTwoTenantFixture(privileged, 'Patient document e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    branchA = (await privileged.branch.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true }, select: { id: true } })).id;
    branchB = (
      await privileged.branch.create({
        data: { tenantId: fixture.tenantA.id, code: 'CN00002', name: 'Chi nhánh B (tài liệu)', isDefault: false, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
      })
    ).id;

    const receptionist = await h.createUser(fixture.tenantA.id, { name: 'receptionist' }, 'doc-recep', [branchA]);
    const doctor = await h.createUser(fixture.tenantA.id, { name: 'doctor' }, 'doc-doctor', [branchA]);
    const nurse = await h.createUser(fixture.tenantA.id, { name: 'nurse' }, 'doc-nurse', [branchA]);
    const admin = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'doc-admin', [branchA]);
    const adminB = await h.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'doc-adminB', [branchB]);
    const labTech = await h.createUser(fixture.tenantA.id, { name: 'lab_technician' }, 'doc-lab', [branchA]);
    const tenantBAdmin = await h.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'doc-adminTB', []);
    doctorId = doctor.id;
    receptionistToken = await h.login(fixture.tenantA.id, receptionist.username);
    doctorToken = await h.login(fixture.tenantA.id, doctor.username);
    nurseToken = await h.login(fixture.tenantA.id, nurse.username);
    adminToken = await h.login(fixture.tenantA.id, admin.username);
    branchBAdminToken = await h.login(fixture.tenantA.id, adminB.username);
    labTechToken = await h.login(fixture.tenantA.id, labTech.username);
    tenantBAdminToken = await h.login(fixture.tenantB.id, tenantBAdmin.username);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  describe('tải lên và lưu trữ', () => {
    it('lưu vào thư mục của bệnh nhân, thư mục "ngày" tính theo giờ Việt Nam, tên tiếng Việt giữ nguyên dấu, tệp đọc lại được qua đường dẫn ký', async () => {
      const patient = await createPatient();
      const doc = await uploadOk(doctorToken, patient.id, 'CLINICAL_PHOTO', JPG, 'Vết thương cẳng tay.jpg', { note: 'Trước khi khâu' });
      expect(doc.displayName).toBe('Vết thương cẳng tay.jpg');
      expect(doc.uploadDate).toBe(getVietnamDateString(new Date()));

      const row = await privileged.patientDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(row.storageKey.startsWith(`patient/${patient.id}/documents/`)).toBe(true);
      expect(row.storageKey.endsWith('.jpg')).toBe(true);
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row.sourceType).toBe('UPLOAD');
      expect(row.branchId).toBe(branchA);

      const file = await http().get(doc.url);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toContain('image/jpeg');
    });

    it('nhận PDF và DICOM; từ chối tệp sai định dạng, rỗng, vượt 15 MB — không để lại tệp hay dòng dữ liệu', async () => {
      const patient = await createPatient();
      await uploadOk(adminToken, patient.id, 'CONTRACT', PDF, 'hop-dong.pdf');
      const dicom = Buffer.alloc(140);
      dicom.write('DICM', 128, 'ascii');
      await uploadOk(adminToken, patient.id, 'CLINICAL_PHOTO', dicom, 'ct.dcm');

      const fake = await upload(adminToken, patient.id, 'CLINICAL_PHOTO', Buffer.from('MZ-không-phải-ảnh'), 'virus.jpg');
      expect(fake.status).toBe(400);
      expect(fake.body.error.code).toBe('PATIENT_DOCUMENT_INVALID_FILE');

      const empty = await upload(adminToken, patient.id, 'CLINICAL_PHOTO', Buffer.alloc(0), 'rong.jpg');
      expect(empty.status).toBe(400);

      const big = Buffer.concat([JPG, Buffer.alloc(15 * 1024 * 1024)]);
      const tooBig = await upload(adminToken, patient.id, 'CLINICAL_PHOTO', big, 'to.jpg');
      expect(tooBig.status).toBeGreaterThanOrEqual(400);
      expect(tooBig.status).toBeLessThan(500);

      expect(await privileged.patientDocument.count({ where: { patientId: patient.id } })).toBe(2);
    });

    it('thiếu tệp hoặc thiếu loại → 400; loại không hợp lệ → 400', async () => {
      const patient = await createPatient();
      const noFile = await http().post(`/api/v1/patients/${patient.id}/documents`).set(authed(adminToken)).field('category', 'CONTRACT');
      expect(noFile.status).toBe(400);
      const badCategory = await upload(adminToken, patient.id, 'KHONG_CO');
      expect(badCategory.status).toBe(400);
    });

    it('gắn lượt khám của đúng bệnh nhân và hiện nhãn; lượt khám lạ hoặc của bệnh nhân khác → 404', async () => {
      const patient = await createPatient();
      const other = await createPatient();
      const reg = await http()
        .post('/api/v1/reception/direct')
        .set(authed(receptionistToken))
        .send({
          patientId: patient.id,
          doctorId,
          checkedInAt: new Date().toISOString(),
          services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
          receptionTypeCode: 'RT_NEW',
          examFormCode: 'EF_NORMAL',
        });
      expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300);
      const encounterId = (reg.body.data.encounter?.id ?? reg.body.data.encounterId ?? reg.body.data.id) as string;

      const doc = await uploadOk(doctorToken, patient.id, 'CLINICAL_PHOTO', JPG, 'a.jpg', { encounterId });
      expect(doc.encounterLabel).toMatch(/^\d{2}\/\d{2}\/\d{4} · /);

      expect((await upload(doctorToken, other.id, 'CLINICAL_PHOTO', JPG, 'a.jpg', { encounterId })).status).toBe(404);
      expect((await upload(doctorToken, patient.id, 'CLINICAL_PHOTO', JPG, 'a.jpg', { encounterId: randomUUID() })).status).toBe(404);
    });
  });

  describe('hai nhóm quyền độc lập', () => {
    it('lễ tân tải và xem hợp đồng nhưng KHÔNG tải, KHÔNG thấy tệp lâm sàng (kể cả đếm và dung lượng)', async () => {
      const patient = await createPatient();
      const clinical = await uploadOk(doctorToken, patient.id, 'CLINICAL_PHOTO');
      const contract = await uploadOk(receptionistToken, patient.id, 'CONTRACT', PDF, 'hd.pdf');

      const denied = await upload(receptionistToken, patient.id, 'CLINICAL_PHOTO');
      expect(denied.status).toBe(403);

      const res = await list(receptionistToken, patient.id);
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((i: { id: string }) => i.id)).toEqual([contract.id]);
      expect(res.body.data.summary.total).toBe(1);
      expect(res.body.data.summary.byCategory.map((c: { category: string }) => c.category)).toEqual(['CONTRACT']);
      expect(res.body.data.access.clinical.read).toBe(false);
      expect(res.body.data.access.contract.upload).toBe(true);

      // Lọc cố tình theo loại lâm sàng vẫn không lộ gì; sửa/xoá tệp lâm sàng như thể không tồn tại.
      expect((await list(receptionistToken, patient.id, '?category=CLINICAL_PHOTO')).body.data.items).toEqual([]);
      const patch = await http().patch(`/api/v1/patients/${patient.id}/documents/${clinical.id}`).set(authed(receptionistToken)).send({ note: 'x', version: clinical.version });
      expect(patch.status).toBe(404);
      const del = await http().delete(`/api/v1/patients/${patient.id}/documents/${clinical.id}?reason=thu&version=${clinical.version}`).set(authed(receptionistToken));
      expect(del.status).toBe(404);
    });

    it('bác sĩ tải và xem tệp lâm sàng nhưng không tải được hợp đồng và không thấy hợp đồng', async () => {
      const patient = await createPatient();
      await uploadOk(doctorToken, patient.id, 'PARACLINICAL');
      await uploadOk(adminToken, patient.id, 'CONTRACT', PDF, 'hd.pdf');
      expect((await upload(doctorToken, patient.id, 'CONTRACT', PDF, 'hd.pdf')).status).toBe(403);

      const res = await list(doctorToken, patient.id);
      expect(res.body.data.items.every((i: { category: string }) => i.category !== 'CONTRACT')).toBe(true);
      expect(res.body.data.summary.total).toBe(1);
    });

    it('quản lý thấy cả hai nhóm; vai trò không có quyền nào (kỹ thuật viên xét nghiệm) → 403', async () => {
      const patient = await createPatient();
      await uploadOk(doctorToken, patient.id, 'CLINICAL_PHOTO');
      await uploadOk(adminToken, patient.id, 'CONTRACT', PDF, 'hd.pdf');
      const res = await list(adminToken, patient.id);
      expect(res.body.data.summary.total).toBe(2);
      expect(res.body.data.summary.byCategory).toHaveLength(4);
      expect((await list(labTechToken, patient.id)).status).toBe(403);
      expect((await upload(labTechToken, patient.id, 'CONTRACT', PDF, 'hd.pdf')).status).toBe(403);
    });

    it('điều dưỡng xem và tải được tệp lâm sàng nhưng không xoá được; chuyển tệp sang loại ngoài nhóm quyền bị chặn', async () => {
      const patient = await createPatient();
      const doc = await uploadOk(nurseToken, patient.id, 'CLINICAL_PHOTO');
      const del = await http().delete(`/api/v1/patients/${patient.id}/documents/${doc.id}?reason=nham&version=${doc.version}`).set(authed(nurseToken));
      expect(del.status).toBe(403);
      const move = await http().patch(`/api/v1/patients/${patient.id}/documents/${doc.id}`).set(authed(nurseToken)).send({ category: 'CONTRACT', version: doc.version });
      expect(move.status).toBe(403);
    });
  });

  describe('thư mục tự tạo', () => {
    it('tạo, trùng tên (không phân biệt hoa thường) bị chặn, đổi tên, xếp tệp vào thư mục, lọc theo thư mục', async () => {
      const patient = await createPatient();
      const created = await http().post(`/api/v1/patients/${patient.id}/documents/folders`).set(authed(doctorToken)).send({ name: 'Theo dõi vết thương' });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const folder = created.body.data as { id: string; version: number };

      const dup = await http().post(`/api/v1/patients/${patient.id}/documents/folders`).set(authed(doctorToken)).send({ name: '  THEO DÕI VẾT THƯƠNG ' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('PATIENT_DOCUMENT_FOLDER_NAME_TAKEN');

      const renamed = await http().patch(`/api/v1/patients/${patient.id}/documents/folders/${folder.id}`).set(authed(doctorToken)).send({ name: 'Vết thương tay', version: folder.version });
      expect(renamed.status).toBe(200);
      const stale = await http().patch(`/api/v1/patients/${patient.id}/documents/folders/${folder.id}`).set(authed(doctorToken)).send({ name: 'Khác', version: folder.version });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');

      const inFolder = await uploadOk(doctorToken, patient.id, 'CLINICAL_PHOTO', JPG, 'a.jpg', { folderId: folder.id });
      expect(inFolder.folderName).toBe('Vết thương tay');
      await uploadOk(doctorToken, patient.id, 'CLINICAL_PHOTO', JPG, 'b.jpg');

      const filtered = await list(doctorToken, patient.id, `?folderId=${folder.id}`);
      expect(filtered.body.data.items.map((i: { id: string }) => i.id)).toEqual([inFolder.id]);
      const none = await list(doctorToken, patient.id, '?folderId=none');
      expect(none.body.data.items).toHaveLength(1);
      expect(filtered.body.data.folders).toEqual([expect.objectContaining({ id: folder.id, name: 'Vết thương tay', fileCount: 1 })]);
    });

    it('xoá thư mục còn tệp → 409 kèm số tệp; thư mục trống xoá được; thư mục của bệnh nhân khác không dùng được', async () => {
      const patient = await createPatient();
      const other = await createPatient();
      const folder = (await http().post(`/api/v1/patients/${patient.id}/documents/folders`).set(authed(adminToken)).send({ name: 'Hồ sơ chuyển viện' })).body.data as { id: string; version: number };
      const doc = await uploadOk(adminToken, patient.id, 'CLINICAL_PHOTO', JPG, 'a.jpg', { folderId: folder.id });

      const blocked = await http().delete(`/api/v1/patients/${patient.id}/documents/folders/${folder.id}?version=${folder.version}`).set(authed(adminToken));
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('PATIENT_DOCUMENT_FOLDER_NOT_EMPTY');
      expect(blocked.body.error.message).toContain('1 tệp');

      expect((await upload(adminToken, other.id, 'CLINICAL_PHOTO', JPG, 'a.jpg', { folderId: folder.id })).status).toBe(404);

      const moved = await http().patch(`/api/v1/patients/${patient.id}/documents/${doc.id}`).set(authed(adminToken)).send({ folderId: null, version: doc.version });
      expect(moved.status).toBe(200);
      const ok = await http().delete(`/api/v1/patients/${patient.id}/documents/folders/${folder.id}?version=${folder.version}`).set(authed(adminToken));
      expect(ok.status).toBe(200);
      expect((await list(adminToken, patient.id)).body.data.folders).toEqual([]);
    });
  });

  describe('sửa và xoá tệp', () => {
    it('sửa tên/ghi chú/loại; sai phiên bản → 409; tên rỗng → 400', async () => {
      const patient = await createPatient();
      const doc = await uploadOk(adminToken, patient.id, 'OTHER');
      const ok = await http().patch(`/api/v1/patients/${patient.id}/documents/${doc.id}`).set(authed(adminToken)).send({ displayName: 'Hợp đồng gói khám', category: 'CONTRACT', note: 'Bản có chữ ký', version: doc.version });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const after = (await list(adminToken, patient.id)).body.data.items[0];
      expect(after).toMatchObject({ displayName: 'Hợp đồng gói khám', category: 'CONTRACT', note: 'Bản có chữ ký', version: doc.version + 1 });

      const stale = await http().patch(`/api/v1/patients/${patient.id}/documents/${doc.id}`).set(authed(adminToken)).send({ note: 'x', version: doc.version });
      expect(stale.status).toBe(409);
      const blank = await http().patch(`/api/v1/patients/${patient.id}/documents/${doc.id}`).set(authed(adminToken)).send({ displayName: '   ', version: after.version });
      expect(blank.status).toBe(400);
    });

    it('xoá cần lý do; xoá mềm (dòng và tệp vẫn còn, ẩn khỏi danh sách); xoá lại → 404', async () => {
      const patient = await createPatient();
      const doc = await uploadOk(doctorToken, patient.id, 'CLINICAL_PHOTO');
      const noReason = await http().delete(`/api/v1/patients/${patient.id}/documents/${doc.id}?version=${doc.version}`).set(authed(doctorToken));
      expect(noReason.status).toBe(400);

      const del = await http().delete(`/api/v1/patients/${patient.id}/documents/${doc.id}?reason=${encodeURIComponent('Chụp nhầm bệnh nhân')}&version=${doc.version}`).set(authed(doctorToken));
      expect(del.status).toBe(200);
      expect((await list(doctorToken, patient.id)).body.data.items).toEqual([]);
      const row = await privileged.patientDocument.findUniqueOrThrow({ where: { id: doc.id } });
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedReason).toBe('Chụp nhầm bệnh nhân');
      const again = await http().delete(`/api/v1/patients/${patient.id}/documents/${doc.id}?reason=lan2&version=${doc.version + 1}`).set(authed(doctorToken));
      expect(again.status).toBe(404);
    });

    it('dòng tham chiếu từ nơi khác chỉ đọc: sửa hoặc xoá → 409 PATIENT_DOCUMENT_READ_ONLY', async () => {
      const patient = await createPatient();
      // Từ giai đoạn 2 dòng tham chiếu do máy chủ tự dựng từ kết quả cận lâm sàng ĐÃ DUYỆT (không còn tự chèn tay một dòng mồ côi: nó sẽ bị dọn vì không có nguồn).
      await seedClsResult(privileged, { tenantId: fixture.tenantA.id, branchId: branchA, patientId: patient.id, serviceName: 'Siêu âm ổ bụng', images: [{ storageKey: `paraclinical/${randomUUID()}/x.jpg`, fileName: 'sa.jpg' }] });
      const listed = (await list(adminToken, patient.id)).body.data.items[0];
      const ref = { id: listed.id as string };
      expect(listed).toMatchObject({ readOnly: true, source: 'PARACLINICAL_IMAGE' });
      const patch = await http().patch(`/api/v1/patients/${patient.id}/documents/${ref.id}`).set(authed(adminToken)).send({ note: 'x', version: 1 });
      expect(patch.status).toBe(409);
      expect(patch.body.error.code).toBe('PATIENT_DOCUMENT_READ_ONLY');
      const del = await http().delete(`/api/v1/patients/${patient.id}/documents/${ref.id}?reason=thu&version=1`).set(authed(adminToken));
      expect(del.status).toBe(409);
    });
  });

  describe('danh sách', () => {
    it('phân trang bằng con trỏ, mới nhất trước, không trùng và không sót; lọc theo loại và từ khoá', async () => {
      const patient = await createPatient();
      const ids: string[] = [];
      for (const [i, name] of ['a', 'b', 'c'].entries()) {
        ids.push((await uploadOk(adminToken, patient.id, i === 2 ? 'CONTRACT' : 'CLINICAL_PHOTO', i === 2 ? PDF : JPG, `${name}.${i === 2 ? 'pdf' : 'jpg'}`, { note: `ghi chú ${name}` })).id);
      }
      const p1 = await list(adminToken, patient.id, '?limit=2');
      expect(p1.body.data.items).toHaveLength(2);
      expect(p1.body.data.nextCursor).not.toBeNull();
      const p2 = await list(adminToken, patient.id, `?limit=2&cursor=${encodeURIComponent(p1.body.data.nextCursor)}`);
      expect(p2.body.data.items).toHaveLength(1);
      expect(p2.body.data.nextCursor).toBeNull();
      const all = [...p1.body.data.items, ...p2.body.data.items].map((i: { id: string }) => i.id);
      expect(new Set(all).size).toBe(3);
      expect(all).toEqual([...ids].reverse());

      expect((await list(adminToken, patient.id, '?category=CONTRACT')).body.data.items).toHaveLength(1);
      expect((await list(adminToken, patient.id, '?q=GHI%20CH%C3%9A%20B')).body.data.items).toHaveLength(1);
      expect((await list(adminToken, patient.id, '?limit=500')).status).toBe(400);
    });

    it('thư mục "ngày" không có bản ghi riêng; lọc theo khoảng ngày', async () => {
      const patient = await createPatient();
      await uploadOk(adminToken, patient.id, 'OTHER');
      const today = getVietnamDateString(new Date());
      expect((await list(adminToken, patient.id, `?dateFrom=${today}&dateTo=${today}`)).body.data.items).toHaveLength(1);
      expect((await list(adminToken, patient.id, '?dateTo=2020-01-01')).body.data.items).toEqual([]);
      expect((await list(adminToken, patient.id)).body.data.summary).toMatchObject({ total: 1, firstUploadDate: today, lastUploadDate: today });
    });
  });

  describe('cô lập công ty và chi nhánh', () => {
    it('công ty khác không thấy, không sửa, không xoá, không tải lên cho bệnh nhân của công ty này', async () => {
      const patient = await createPatient();
      const doc = await uploadOk(adminToken, patient.id, 'CLINICAL_PHOTO');
      expect((await list(tenantBAdminToken, patient.id)).status).toBe(404);
      expect((await upload(tenantBAdminToken, patient.id, 'CLINICAL_PHOTO')).status).toBe(404);
      expect((await http().patch(`/api/v1/patients/${patient.id}/documents/${doc.id}`).set(authed(tenantBAdminToken)).send({ note: 'x', version: 1 })).status).toBe(404);
      expect((await http().delete(`/api/v1/patients/${patient.id}/documents/${doc.id}?reason=thu&version=1`).set(authed(tenantBAdminToken))).status).toBe(404);
      // Đường dẫn ký của công ty này không đọc được bằng khoá của công ty kia: token chốt cứng tenant, sửa token → từ chối.
      const tampered = doc.url.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
      expect((await http().get(tampered)).status).toBe(403);
    });

    it('tệp đi theo BỆNH NHÂN: chi nhánh khác vẫn xem được, tệp ghi đúng chi nhánh nơi tải lên, công ty nhiều chi nhánh bật cờ multiBranch', async () => {
      const patient = await createPatient();
      const doc = await uploadOk(adminToken, patient.id, 'CLINICAL_PHOTO');
      expect(doc.branchId).toBe(branchA);
      const fromB = await list(branchBAdminToken, patient.id);
      expect(fromB.status).toBe(200);
      expect(fromB.body.data.items[0]).toMatchObject({ id: doc.id, branchId: branchA, branchName: expect.any(String) });
      expect(fromB.body.data.multiBranch).toBe(true);
      expect(fromB.body.data.currentBranchId).toBe(branchB);

      const own = await uploadOk(branchBAdminToken, patient.id, 'CLINICAL_PHOTO', JPG, 'anh-chi-nhanh-b.jpg');
      expect(own.branchId).toBe(branchB);
    });
  });

  describe('gộp hồ sơ', () => {
    it('gộp hồ sơ chuyển MỌI tệp và thư mục sang hồ sơ đích; thư mục trùng tên gộp vào thư mục đích, không mất tệp nào', async () => {
      const source = await createPatient();
      const target = await createPatient();
      const mkFolder = async (patientId: string, name: string) => (await http().post(`/api/v1/patients/${patientId}/documents/folders`).set(authed(adminToken)).send({ name })).body.data as { id: string };
      const sameInSource = await mkFolder(source.id, 'Theo dõi');
      const onlyInSource = await mkFolder(source.id, 'Riêng nguồn');
      const sameInTarget = await mkFolder(target.id, 'THEO DÕI');
      const a = await uploadOk(adminToken, source.id, 'CLINICAL_PHOTO', JPG, 'a.jpg', { folderId: sameInSource.id });
      const b = await uploadOk(adminToken, source.id, 'CONTRACT', PDF, 'b.pdf', { folderId: onlyInSource.id });
      const c = await uploadOk(adminToken, target.id, 'CLINICAL_PHOTO', JPG, 'c.jpg', { folderId: sameInTarget.id });

      const merged = await http().post('/api/v1/patients/merge').set(authed(adminToken)).send({ sourceId: source.id, targetId: target.id });
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);

      const res = await list(adminToken, target.id);
      expect(res.body.data.items.map((i: { id: string }) => i.id).sort()).toEqual([a.id, b.id, c.id].sort());
      const names = res.body.data.folders.map((f: { name: string }) => f.name).sort();
      expect(names).toEqual(['Riêng nguồn', 'THEO DÕI']);
      expect(res.body.data.items.find((i: { id: string }) => i.id === a.id).folderName).toBe('THEO DÕI');
      expect(await privileged.patientDocument.count({ where: { patientId: source.id, deletedAt: null } })).toBe(0);
    });
  });

  describe('nhật ký kiểm toán', () => {
    it('ghi tải lên/sửa/xoá và xem danh sách; KHÔNG ghi tên tệp; mọi hành động có nhãn tiếng Việt', async () => {
      const patient = await createPatient();
      const doc = await uploadOk(doctorToken, patient.id, 'CLINICAL_PHOTO', JPG, 'Nguyễn Văn An - phim.jpg');
      await http().patch(`/api/v1/patients/${patient.id}/documents/${doc.id}`).set(authed(doctorToken)).send({ note: 'x', version: doc.version });
      await list(doctorToken, patient.id);
      const rows = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, entityId: doc.id } });
      expect(rows.map((r) => r.action).sort()).toEqual(['patient_document.updated', 'patient_document.uploaded']);
      expect(JSON.stringify(rows)).not.toContain('Nguyễn Văn An');
    });
  });

  describe('không trùng tên tệp', () => {
    it('tải trùng tên (không phân biệt hoa thường) → 409, không để lại dòng; hồ sơ khác dùng lại tên được; xoá rồi dùng lại tên được', async () => {
      const patient = await createPatient();
      const other = await createPatient();
      const first = await uploadOk(adminToken, patient.id, 'CLINICAL_PHOTO', JPG, 'Phim X-quang.jpg');

      const dup = await upload(adminToken, patient.id, 'CLINICAL_PHOTO', JPG, 'phim x-QUANG.jpg');
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('PATIENT_DOCUMENT_NAME_TAKEN');
      expect(dup.body.error.message).toContain('phim x-QUANG.jpg');
      expect(await privileged.patientDocument.count({ where: { patientId: patient.id } })).toBe(1);

      await uploadOk(adminToken, other.id, 'CLINICAL_PHOTO', JPG, 'Phim X-quang.jpg');

      const del = await http().delete(`/api/v1/patients/${patient.id}/documents/${first.id}?reason=nham&version=${first.version}`).set(authed(adminToken));
      expect(del.status).toBe(200);
      await uploadOk(adminToken, patient.id, 'CLINICAL_PHOTO', JPG, 'Phim X-quang.jpg');
    });

    it('đổi tên trùng tên tệp khác → 409; đổi hoa thường của chính tên mình thì được', async () => {
      const patient = await createPatient();
      await uploadOk(adminToken, patient.id, 'OTHER', JPG, 'a.jpg');
      const second = await uploadOk(adminToken, patient.id, 'OTHER', JPG, 'b.jpg');
      const clash = await http().patch(`/api/v1/patients/${patient.id}/documents/${second.id}`).set(authed(adminToken)).send({ displayName: 'A.JPG', version: second.version });
      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('PATIENT_DOCUMENT_NAME_TAKEN');
      const own = await http().patch(`/api/v1/patients/${patient.id}/documents/${second.id}`).set(authed(adminToken)).send({ displayName: 'B.JPG', version: second.version });
      expect(own.status, JSON.stringify(own.body)).toBe(200);
    });

    it('gộp hồ sơ: tệp trùng tên ở hồ sơ đích được thêm hậu tố "(từ hồ sơ gộp)", không mất tệp và không lỗi', async () => {
      const source = await createPatient();
      const target = await createPatient();
      const a = await uploadOk(adminToken, source.id, 'CLINICAL_PHOTO', JPG, 'phim.jpg');
      const b = await uploadOk(adminToken, target.id, 'CLINICAL_PHOTO', JPG, 'Phim.jpg');
      const merged = await http().post('/api/v1/patients/merge').set(authed(adminToken)).send({ sourceId: source.id, targetId: target.id });
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);
      const names = (await list(adminToken, target.id)).body.data.items.map((i: { id: string; displayName: string }) => [i.id, i.displayName]);
      expect(names).toHaveLength(2);
      expect(names.find(([id]: [string, string]) => id === a.id)?.[1]).toBe('phim (từ hồ sơ gộp).jpg');
      expect(names.find(([id]: [string, string]) => id === b.id)?.[1]).toBe('Phim.jpg');
    });
  });

  describe('chống ghi trùng khi tải lên (Idempotency-Key)', () => {
    const uploadWithKey = (token: string, patientId: string, key: string, file: Buffer, filename: string) =>
      http().post(`/api/v1/patients/${patientId}/documents`).set(authed(token)).set('Idempotency-Key', key).field('category', 'CLINICAL_PHOTO').attach('file', file, { filename });

    it('gửi lại cùng khoá và cùng nội dung → trả đúng kết quả cũ, chỉ MỘT dòng và MỘT tệp', async () => {
      const patient = await createPatient();
      const key = randomUUID();
      const first = await uploadWithKey(adminToken, patient.id, key, JPG, 'anh.jpg');
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const again = await uploadWithKey(adminToken, patient.id, key, JPG, 'anh.jpg');
      expect(again.status).toBe(200);
      expect(again.body.data.id).toBe(first.body.data.id);
      expect(await privileged.patientDocument.count({ where: { patientId: patient.id } })).toBe(1);
    });

    it('cùng khoá nhưng tệp khác → bị từ chối, không ghi thêm', async () => {
      const patient = await createPatient();
      const key = randomUUID();
      expect((await uploadWithKey(adminToken, patient.id, key, JPG, 'a.jpg')).status).toBe(200);
      const other = await uploadWithKey(adminToken, patient.id, key, Buffer.concat([JPG, Buffer.from('khac')]), 'b.jpg');
      expect(other.status).toBeGreaterThanOrEqual(400);
      expect(await privileged.patientDocument.count({ where: { patientId: patient.id } })).toBe(1);
    });

    it('khoá không đúng định dạng → 400; thiếu khoá thì chạy như cũ', async () => {
      const patient = await createPatient();
      expect((await uploadWithKey(adminToken, patient.id, 'khong-phai-uuid', JPG, 'a.jpg')).status).toBe(400);
      expect((await upload(adminToken, patient.id, 'CLINICAL_PHOTO', JPG, 'a.jpg')).status).toBe(200);
    });

    it('lỗi nghiệp vụ (trùng tên) nhả khoá: đổi tên tệp rồi gửi lại cùng khoá vẫn chạy', async () => {
      const patient = await createPatient();
      await uploadOk(adminToken, patient.id, 'CLINICAL_PHOTO', JPG, 'trung.jpg');
      const key = randomUUID();
      const clash = await uploadWithKey(adminToken, patient.id, key, JPG, 'trung.jpg');
      expect(clash.status).toBe(409);
      const retry = await uploadWithKey(adminToken, patient.id, key, JPG, 'da-doi-ten.jpg');
      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    });
  });
});
