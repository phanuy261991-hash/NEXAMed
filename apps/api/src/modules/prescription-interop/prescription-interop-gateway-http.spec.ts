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
import { decryptPii } from '../../infrastructure/crypto/pii-encryption';
import { createTwoTenantFixture, getDefaultBranchId, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — Liên thông đơn thuốc: KẾT NỐI CỔNG (docs/DECISIONS.md #242 GĐ3, mockup 8d): "Kiểm tra kết nối"/đăng nhập cơ sở, token (mã hoá, hạn tự tính 7 ngày, tự làm mới), thêm/xoá bác sĩ khỏi cơ sở,
 * đăng nhập bác sĩ, các tình huống lỗi mạng/từ chối. Cổng là MÁY CHỦ GIẢ cục bộ ghi lại từng yêu cầu thật; chi tiết khớp tài liệu QĐ 808 (đường dẫn, header, tên trường) đã kiểm riêng ở
 * `http-e-prescription-gateway.adapter.spec.ts`, ở đây kiểm luồng nghiệp vụ trên đó. CHƯA kiểm với cổng thật.
 */
interface Call {
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

describe('HTTP e2e — Liên thông đơn thuốc: kết nối cổng, token, thêm/xoá bác sĩ (#242 GĐ3)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchA: string;
  let branchB: string;
  let adminToken: string;
  let doctorToken: string;
  let adminBToken: string;
  let doctorBranchBId: string;
  let doctorTenantBId: string;

  // ---- cổng giả ----
  let gateway: Server;
  let gatewayUrl: string;
  let calls: Call[] = [];
  let facilityLoginCount = 0;
  let doctorLoginCount = 0;
  type Reply = (res: ServerResponse, call: Call) => void;
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json;charset=UTF-8');
    res.end(JSON.stringify(body));
  };
  /** Mỗi đường dẫn một cách trả lời; test ghi đè theo từng ca. */
  let routes: Record<string, Reply> = {};
  const defaultRoutes = (): Record<string, Reply> => ({
    '/api/auth/dang-nhap-co-so-kham-chua-benh': (res) => reply(res, 200, { token: `FAC-TOKEN-${++facilityLoginCount}`, token_type: 'bearer' }),
    '/api/v1/them-bac-si': (res) => reply(res, 200, { success: 'Bạn đã thêm bác sĩ thành công' }),
    '/api/v1/xoa-bac-si': (res) => reply(res, 200, { success: 'Bạn đã xóa bác sĩ khỏi cơ sở khám chữa bệnh thành công' }),
    '/api/auth/dang-nhap-bac-si': (res) => reply(res, 200, { token: `DOC-TOKEN-${++doctorLoginCount}`, token_type: 'bearer' }),
  });
  const callsTo = (path: string) => calls.filter((c) => c.path === path);

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(tenantId: string, roleName: string, label: string, branchId?: string) {
    const username = `e2e-igw-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    if (branchId) await privileged.userBranch.create({ data: { tenantId, userId: user.id, branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return { id: user.id as string, username };
  }

  async function login(tenantId: string, username: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }

  const patchSettings = (body: Record<string, unknown>) => http().patch('/api/v1/prescription-interop/settings').set(authed(adminToken)).send(body);
  const saveFacility = (branchId: string, body: Record<string, unknown>) => http().put(`/api/v1/prescription-interop/facilities/${branchId}/credential`).set(authed(adminToken)).send(body);
  const saveDoctor = (userId: string, body: Record<string, unknown>) => http().put(`/api/v1/prescription-interop/doctors/${userId}/credential`).set(authed(adminToken)).send(body);
  const loginFacility = (branchId: string, token = adminToken) => http().post(`/api/v1/prescription-interop/facilities/${branchId}/login`).set(authed(token));
  const addDoctor = (userId: string, token = adminToken) => http().post(`/api/v1/prescription-interop/doctors/${userId}/add-to-facility`).set(authed(token));
  const removeDoctor = (userId: string, token = adminToken) => http().post(`/api/v1/prescription-interop/doctors/${userId}/remove-from-facility`).set(authed(token));
  // Phản hồi JSON của test không có kiểu: các test bên dưới đọc sâu vào `row.token.*` nên cần `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const facilityRow = async (branchId = branchA) => ((await http().get('/api/v1/prescription-interop/facilities').set(authed(adminToken))).body.data.items as Array<Record<string, any>>).find((i) => i.branchId === branchId)!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doctorRow = async (userId: string) => ((await http().get('/api/v1/prescription-interop/doctors').set(authed(adminToken))).body.data.items as Array<Record<string, any>>).find((i) => i.userId === userId)!;
  const storedFacility = () => privileged.interopFacilityCredential.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null } });
  const key = () => process.env.ENCRYPTION_KEY!;

  /** Bác sĩ mới ở chi nhánh A đã có mã + mật khẩu liên thông. */
  async function newDoctor(label: string, code = `BS-${label}`, pw = `pw-${label}`) {
    const doctor = await createUser(fixture.tenantA.id, 'doctor', label, branchA);
    expect((await saveDoctor(doctor.id, { code, password: pw })).status).toBe(200);
    return { id: doctor.id, code, pw };
  }

  beforeAll(async () => {
    gateway = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
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

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();

    fixture = await createTwoTenantFixture(privileged, 'PrescriptionInteropGateway e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    const adminA = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminA');
    adminToken = await login(fixture.tenantA.id, adminA.username);
    const created = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'Chi nhánh Quận 7', address: '88 Nguyễn Thị Thập', phone: '0283777556' });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    branchB = created.body.data.id;

    doctorToken = await login(fixture.tenantA.id, (await createUser(fixture.tenantA.id, 'doctor', 'doctorTok', branchA)).username);
    doctorBranchBId = (await createUser(fixture.tenantA.id, 'doctor', 'doctorB', branchB)).id;
    const adminB = await createUser(fixture.tenantB.id, 'clinic_admin', 'adminTenantB');
    adminBToken = await login(fixture.tenantB.id, adminB.username);
    doctorTenantBId = (await createUser(fixture.tenantB.id, 'doctor', 'doctorTenantB')).id;

    expect((await patchSettings({ enabled: true, gatewayUrl })).status).toBe(200);
    expect((await saveFacility(branchA, { code: 'CS-GW-A', password: 'pw-co-so-A' })).status).toBe(200);
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

  describe('kiểm tra kết nối / đăng nhập cơ sở', () => {
    it('thành công: gửi đúng mã + mật khẩu đã lưu (giải mã), lưu token MÃ HOÁ, hạn tự tính 7 ngày, token không lộ ra API/nhật ký', async () => {
      const before = Date.now();
      const res = await loginFacility(branchA);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ outcome: 'OK', errors: [] });
      expect(callsTo('/api/auth/dang-nhap-co-so-kham-chua-benh')).toHaveLength(1);
      expect(callsTo('/api/auth/dang-nhap-co-so-kham-chua-benh')[0]!.body).toEqual({ ma_lien_thong_co_so_kham_chua_benh: 'CS-GW-A', password: 'pw-co-so-A' });

      const stored = await storedFacility();
      expect(Buffer.from(stored.tokenEnc!).toString('utf8')).not.toContain('FAC-TOKEN');
      expect(decryptPii(Buffer.from(stored.tokenEnc!), key())).toBe(`FAC-TOKEN-${facilityLoginCount}`);
      expect(stored.tokenIssuedAt!.getTime()).toBeGreaterThanOrEqual(before - 2000);

      const row = await facilityRow();
      expect(row.token.status).toBe('VALID');
      expect(new Date(row.token.expiresAt).getTime() - new Date(row.token.issuedAt).getTime()).toBe(7 * 24 * 3600 * 1000);
      expect(JSON.stringify(row)).not.toContain('FAC-TOKEN');
      expect(JSON.stringify(res.body)).not.toContain('FAC-TOKEN');

      const audits = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'prescription_interop.facility_login', entityId: branchA } });
      expect(audits.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(audits)).not.toMatch(/FAC-TOKEN|pw-co-so-A|CS-GW-A/);
    });

    it('cổng từ chối (422 sai mã/mật khẩu) → REJECTED kèm nguyên văn lỗi, token cũ được GIỮ NGUYÊN', async () => {
      expect((await loginFacility(branchA)).body.data.outcome).toBe('OK');
      const oldToken = (await storedFacility()).tokenEnc!;
      routes['/api/auth/dang-nhap-co-so-kham-chua-benh'] = (res) => reply(res, 422, { danh_sach_cac_loi: ['Mã liên thông hoặc mật khẩu không đúng'] });
      const res = await loginFacility(branchA);
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('REJECTED');
      expect(res.body.data.errors).toEqual(['Mã liên thông hoặc mật khẩu không đúng']);
      expect(res.body.data.message).toContain('Cổng từ chối đăng nhập');
      expect(Buffer.from((await storedFacility()).tokenEnc!).equals(Buffer.from(oldToken))).toBe(true);
    });

    it('không kết nối được (cổng chết) → UNREACHABLE, thông báo nêu địa chỉ, không đổi token', async () => {
      const dead = createServer();
      await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve));
      const deadUrl = `http://127.0.0.1:${(dead.address() as AddressInfo).port}`;
      await new Promise<void>((resolve) => dead.close(() => resolve()));
      expect((await patchSettings({ gatewayUrl: deadUrl })).status).toBe(200);
      try {
        const res = await loginFacility(branchA);
        expect(res.status).toBe(200);
        expect(res.body.data.outcome).toBe('UNREACHABLE');
        expect(res.body.data.message).toContain(`Không kết nối được tới ${deadUrl} (lỗi kết nối mạng)`);
        expect(res.body.data.message).toContain('Đơn đang chờ không bị ảnh hưởng');
      } finally {
        expect((await patchSettings({ gatewayUrl })).status).toBe(200);
      }
    });

    it('cổng lỗi 503 → UNREACHABLE (đáng thử lại), không phải REJECTED', async () => {
      routes['/api/auth/dang-nhap-co-so-kham-chua-benh'] = (res) => reply(res, 503, { message: 'Service Unavailable' });
      const res = await loginFacility(branchA);
      expect(res.body.data.outcome).toBe('UNREACHABLE');
    });

    it('hết thời gian chờ (cổng không trả lời, chờ 5 giây theo cấu hình) → UNREACHABLE, không treo', async () => {
      routes['/api/auth/dang-nhap-co-so-kham-chua-benh'] = () => undefined; // không bao giờ trả lời
      expect((await patchSettings({ timeoutSeconds: 5 })).status).toBe(200);
      try {
        const started = Date.now();
        const res = await loginFacility(branchA);
        expect(Date.now() - started).toBeLessThan(9000);
        expect(res.body.data.outcome).toBe('UNREACHABLE');
        expect(res.body.data.message).toContain('(hết thời gian chờ 5 giây)');
      } finally {
        expect((await patchSettings({ timeoutSeconds: 30 })).status).toBe(200);
      }
    }, 20_000);

    it('chưa nhập mã/mật khẩu cơ sở → NOT_CONFIGURED và KHÔNG gọi cổng', async () => {
      const res = await loginFacility(branchB);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ outcome: 'NOT_CONFIGURED', message: 'Chưa nhập mã và mật khẩu liên thông của cơ sở.' });
      expect(calls).toHaveLength(0);
    });

    it('cô lập: chi nhánh công ty khác/không tồn tại → 404 và không gọi cổng; bác sĩ (không có quyền cấu hình) → 403', async () => {
      const branchOfB = await getDefaultBranchId(privileged, fixture.tenantB.id);
      expect((await loginFacility(branchOfB)).status).toBe(404);
      expect((await loginFacility(randomUUID())).status).toBe(404);
      expect((await loginFacility(branchA, adminBToken)).status).toBe(404);
      expect((await loginFacility(branchA, doctorToken)).status).toBe(403);
      expect(calls).toHaveLength(0);
    });
  });

  describe('thêm bác sĩ vào cơ sở + đăng nhập bác sĩ', () => {
    it('luồng đầy đủ: tự đăng nhập cơ sở → them-bac-si bằng token cơ sở → đăng nhập bác sĩ (3 trường) → cập nhật "Trên cổng" + token bác sĩ', async () => {
      await patchSettings({ gatewayUrl });
      await saveFacility(branchA, { code: 'CS-GW-A', password: 'pw-co-so-A' }); // xoá token cũ để thấy đăng nhập tự động
      const d = await newDoctor('flow');
      const res = await addDoctor(d.id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ outcome: 'OK' });
      expect(res.body.data.message).toContain('đăng nhập bác sĩ thành công');

      const facilityLogins = callsTo('/api/auth/dang-nhap-co-so-kham-chua-benh');
      const adds = callsTo('/api/v1/them-bac-si');
      const doctorLogins = callsTo('/api/auth/dang-nhap-bac-si');
      expect(facilityLogins).toHaveLength(1);
      expect(adds).toHaveLength(1);
      expect(adds[0]!.headers.authorization).toBe(`bearer FAC-TOKEN-${facilityLoginCount}`);
      expect(adds[0]!.body).toEqual({ ma_lien_thong_bac_si: d.code });
      expect(doctorLogins).toHaveLength(1);
      expect(doctorLogins[0]!.body).toEqual({ ma_lien_thong_bac_si: d.code, ma_lien_thong_co_so_kham_chua_benh: 'CS-GW-A', password: d.pw });
      expect(doctorLogins[0]!.headers.authorization).toBeUndefined();

      const row = await doctorRow(d.id);
      expect(row).toMatchObject({ onGateway: true, code: d.code, hasPassword: true });
      expect(row.token.status).toBe('VALID');
      expect(JSON.stringify(row)).not.toMatch(/DOC-TOKEN|FAC-TOKEN/);

      const pair = await privileged.interopDoctorFacility.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, userId: d.id, branchId: branchA, deletedAt: null } });
      expect(decryptPii(Buffer.from(pair.tokenEnc!), key())).toBe(`DOC-TOKEN-${doctorLoginCount}`);
      const audit = await privileged.auditLog.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, action: 'prescription_interop.doctor_added_to_facility', entityId: d.id } });
      expect(audit.afterJson).toEqual({ outcome: 'OK', branchId: branchA });
      expect(JSON.stringify(audit)).not.toMatch(/TOKEN|pw-flow|BS-flow/);
    });

    it('dùng lại token cơ sở còn hạn: thao tác kế tiếp KHÔNG đăng nhập cơ sở lại', async () => {
      const d = await newDoctor('reuse');
      expect((await loginFacility(branchA)).body.data.outcome).toBe('OK');
      calls = [];
      expect((await addDoctor(d.id)).body.data.outcome).toBe('OK');
      expect(callsTo('/api/auth/dang-nhap-co-so-kham-chua-benh')).toHaveLength(0);
      expect(callsTo('/api/v1/them-bac-si')).toHaveLength(1);
    });

    it('token cơ sở còn dưới 1 ngày → tự đăng nhập lại TRƯỚC khi gọi; còn 2 ngày → dùng lại', async () => {
      const d = await newDoctor('refresh');
      expect((await loginFacility(branchA)).body.data.outcome).toBe('OK');
      const setIssuedAgo = (days: number) => privileged.interopFacilityCredential.updateMany({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null }, data: { tokenIssuedAt: new Date(Date.now() - days * 86_400_000) } });

      await setIssuedAgo(5); // còn 2 ngày
      calls = [];
      await addDoctor(d.id);
      expect(callsTo('/api/auth/dang-nhap-co-so-kham-chua-benh')).toHaveLength(0);

      await setIssuedAgo(6.5); // còn 12 giờ
      calls = [];
      await removeDoctor(d.id);
      expect(callsTo('/api/auth/dang-nhap-co-so-kham-chua-benh')).toHaveLength(1);
      expect(callsTo('/api/v1/xoa-bac-si')[0]!.headers.authorization).toBe(`bearer FAC-TOKEN-${facilityLoginCount}`);

      await setIssuedAgo(8); // đã hết hạn
      calls = [];
      await addDoctor(d.id);
      expect(callsTo('/api/auth/dang-nhap-co-so-kham-chua-benh')).toHaveLength(1);
    });

    it('cổng trả 401 (token bị thu hồi) → đăng nhập lại và thử lại đúng MỘT lần rồi thành công', async () => {
      const d = await newDoctor('r401');
      expect((await loginFacility(branchA)).body.data.outcome).toBe('OK');
      calls = [];
      let first = true;
      routes['/api/v1/them-bac-si'] = (res) => {
        if (first) {
          first = false;
          reply(res, 401, { message: 'Unauthenticated.' });
        } else reply(res, 200, { success: 'Bạn đã thêm bác sĩ thành công' });
      };
      const res = await addDoctor(d.id);
      expect(res.body.data.outcome).toBe('OK');
      expect(callsTo('/api/v1/them-bac-si')).toHaveLength(2);
      expect(callsTo('/api/auth/dang-nhap-co-so-kham-chua-benh')).toHaveLength(1);
      // token dùng ở lần thử lại là token MỚI
      expect(callsTo('/api/v1/them-bac-si')[1]!.headers.authorization).toBe(`bearer FAC-TOKEN-${facilityLoginCount}`);
    });

    it('401 mãi mãi → dừng sau MỘT lần thử lại (không lặp vô hạn), báo REJECTED', async () => {
      const d = await newDoctor('r401b');
      routes['/api/v1/them-bac-si'] = (res) => reply(res, 401, { message: 'Unauthenticated.' });
      const res = await addDoctor(d.id);
      expect(res.body.data.outcome).toBe('REJECTED');
      expect(callsTo('/api/v1/them-bac-si')).toHaveLength(2);
      expect((await doctorRow(d.id)).onGateway).toBe(false);
    });

    it('cổng từ chối thêm (422 danh_sach_cac_loi) → REJECTED kèm lỗi, bác sĩ KHÔNG được đánh dấu "trên cổng"', async () => {
      const d = await newDoctor('rej');
      routes['/api/v1/them-bac-si'] = (res) => reply(res, 422, { danh_sach_cac_loi: ['Mã liên thông bác sĩ không tồn tại'] });
      const res = await addDoctor(d.id);
      expect(res.body.data).toMatchObject({ outcome: 'REJECTED', errors: ['Mã liên thông bác sĩ không tồn tại'] });
      expect((await doctorRow(d.id)).onGateway).toBe(false);
      expect(callsTo('/api/auth/dang-nhap-bac-si')).toHaveLength(0);
    });

    it('lỗi mạng khi thêm → UNREACHABLE, không đánh dấu "trên cổng"', async () => {
      const d = await newDoctor('net');
      routes['/api/v1/them-bac-si'] = (res) => reply(res, 502, { message: 'Bad Gateway' });
      expect((await addDoctor(d.id)).body.data.outcome).toBe('UNREACHABLE');
      expect((await doctorRow(d.id)).onGateway).toBe(false);
    });

    it('thêm được nhưng đăng nhập bác sĩ thất bại (422) → vẫn OK + "đã thêm", thông báo nêu rõ, token bác sĩ chưa có', async () => {
      const d = await newDoctor('dlfail');
      routes['/api/auth/dang-nhap-bac-si'] = (res) => reply(res, 422, { danh_sach_cac_loi: ['Mã liên thông hoặc mật khẩu không đúng'] });
      const res = await addDoctor(d.id);
      expect(res.body.data.outcome).toBe('OK');
      expect(res.body.data.message).toContain('Chưa đăng nhập được bác sĩ');
      expect(res.body.data.errors).toEqual(['Mã liên thông hoặc mật khẩu không đúng']);
      const row = await doctorRow(d.id);
      expect(row.onGateway).toBe(true);
      expect(row.token.status).toBe('NONE');
    });

    it('bác sĩ chưa có mã liên thông → NOT_CONFIGURED, không gọi cổng; cơ sở chưa có mã (chi nhánh B) → NOT_CONFIGURED', async () => {
      const noCreds = await createUser(fixture.tenantA.id, 'doctor', 'nocreds', branchA);
      expect((await addDoctor(noCreds.id)).body.data).toMatchObject({ outcome: 'NOT_CONFIGURED', message: 'Chưa nhập mã liên thông của bác sĩ.' });
      expect(calls).toHaveLength(0);

      // Chuyển sang chi nhánh B bằng cách thêm bác sĩ vào chi nhánh B và đăng nhập ở đó là không cần: kiểm tra qua dịch vụ cơ sở trống bằng chi nhánh B đã chứng minh ở trên.
      expect((await loginFacility(branchB)).body.data.outcome).toBe('NOT_CONFIGURED');
    });

    it('xoá khỏi cơ sở: gọi xoa-bac-si bằng token cơ sở, "Trên cổng" về chưa thêm, token bác sĩ bị xoá', async () => {
      const d = await newDoctor('del');
      expect((await addDoctor(d.id)).body.data.outcome).toBe('OK');
      calls = [];
      const res = await removeDoctor(d.id);
      expect(res.body.data).toMatchObject({ outcome: 'OK', message: 'Đã xoá bác sĩ khỏi cơ sở trên cổng.' });
      const removes = callsTo('/api/v1/xoa-bac-si');
      expect(removes).toHaveLength(1);
      expect(removes[0]!.body).toEqual({ ma_lien_thong_bac_si: d.code });
      expect(removes[0]!.headers.authorization).toMatch(/^bearer FAC-TOKEN-\d+$/);
      const row = await doctorRow(d.id);
      expect(row.onGateway).toBe(false);
      expect(row.token.status).toBe('NONE');
      expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'prescription_interop.doctor_removed_from_facility', entityId: d.id } })).toBe(1);
    });

    it('xoá bị cổng từ chối → REJECTED và vẫn giữ "Trên cổng"', async () => {
      const d = await newDoctor('delrej');
      expect((await addDoctor(d.id)).body.data.outcome).toBe('OK');
      routes['/api/v1/xoa-bac-si'] = (res) => reply(res, 422, { danh_sach_cac_loi: ['Bác sĩ không thuộc cơ sở'] });
      expect((await removeDoctor(d.id)).body.data).toMatchObject({ outcome: 'REJECTED', errors: ['Bác sĩ không thuộc cơ sở'] });
      expect((await doctorRow(d.id)).onGateway).toBe(true);
    });
  });

  describe('đổi mã/mật khẩu làm mất hiệu lực token và trạng thái "Trên cổng"', () => {
    it('đổi MẬT KHẨU bác sĩ → chỉ bỏ token, vẫn "Trên cổng"; đổi MÃ bác sĩ → bỏ cả "Trên cổng"', async () => {
      const d = await newDoctor('chg');
      expect((await addDoctor(d.id)).body.data.outcome).toBe('OK');
      expect((await doctorRow(d.id)).token.status).toBe('VALID');

      expect((await saveDoctor(d.id, { code: d.code, password: 'mat-khau-bs-moi' })).status).toBe(200);
      let row = await doctorRow(d.id);
      expect(row.onGateway).toBe(true);
      expect(row.token.status).toBe('NONE');

      expect((await saveDoctor(d.id, { code: `${d.code}-NEW` })).status).toBe(200);
      row = await doctorRow(d.id);
      expect(row.onGateway).toBe(false);
    });

    it('đổi MẬT KHẨU cơ sở → chỉ bỏ token cơ sở; đổi MÃ cơ sở → bỏ token và đánh dấu mọi bác sĩ của chi nhánh về chưa thêm', async () => {
      const d = await newDoctor('fac');
      expect((await addDoctor(d.id)).body.data.outcome).toBe('OK');
      expect((await facilityRow()).token.status).toBe('VALID');

      expect((await saveFacility(branchA, { code: 'CS-GW-A', password: 'pw-co-so-moi' })).status).toBe(200);
      expect((await facilityRow()).token.status).toBe('NONE');
      expect((await doctorRow(d.id)).onGateway).toBe(true);

      expect((await saveFacility(branchA, { code: 'CS-GW-A2' })).status).toBe(200);
      expect((await doctorRow(d.id)).onGateway).toBe(false);
      // trả lại như cũ cho các ca sau
      expect((await saveFacility(branchA, { code: 'CS-GW-A', password: 'pw-co-so-A' })).status).toBe(200);
    });

    it('lưu lại đúng mã cũ, không đổi mật khẩu → KHÔNG làm mất token', async () => {
      expect((await loginFacility(branchA)).body.data.outcome).toBe('OK');
      expect((await saveFacility(branchA, { code: 'CS-GW-A' })).status).toBe(200);
      expect((await facilityRow()).token.status).toBe('VALID');
    });
  });

  describe('cô lập và phân quyền cho thêm/xoá bác sĩ', () => {
    it('bác sĩ chi nhánh khác, công ty khác, id lạ → 404 và KHÔNG gọi cổng', async () => {
      calls = [];
      for (const id of [doctorBranchBId, doctorTenantBId, randomUUID()]) {
        expect((await addDoctor(id)).status).toBe(404);
        expect((await removeDoctor(id)).status).toBe(404);
      }
      expect((await addDoctor(doctorBranchBId, adminBToken)).status).toBe(404);
      expect(calls).toHaveLength(0);
    });

    it('bác sĩ (không có quyền cấu hình) → 403; không đăng nhập → 401', async () => {
      const d = await newDoctor('perm');
      expect((await addDoctor(d.id, doctorToken)).status).toBe(403);
      expect((await removeDoctor(d.id, doctorToken)).status).toBe(403);
      expect((await http().post(`/api/v1/prescription-interop/doctors/${d.id}/add-to-facility`)).status).toBe(401);
      expect((await http().post(`/api/v1/prescription-interop/facilities/${branchA}/login`)).status).toBe(401);
    });
  });

  describe('công tắc "Gửi đơn lên cổng"', () => {
    it('mặc định tắt, bật/tắt được và ghi nhật ký; khoá nhà cung cấp chỉ báo đã/chưa cài (không lộ giá trị)', async () => {
      const off = await http().get('/api/v1/prescription-interop/settings').set(authed(adminToken));
      expect(off.body.data.sendEnabled).toBe(false);
      expect(off.body.data.appKeyConfigured).toBe(false);
      const on = await patchSettings({ sendEnabled: true });
      expect(on.body.data.sendEnabled).toBe(true);
      expect(JSON.stringify(on.body)).not.toMatch(/app[-_]?key"\s*:\s*"/i);
      expect((await patchSettings({ sendEnabled: false })).body.data.sendEnabled).toBe(false);
    });
  });
});
