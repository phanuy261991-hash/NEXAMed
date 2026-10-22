import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AccountLockedError } from '@nexamed/core';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { encryptPii } from '../../infrastructure/crypto/pii-encryption';
import { generateTotpSecret, totpAt } from '../../infrastructure/crypto/totp';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { createTwoTenantFixture, type TwoTenantFixture } from '../../testing/tenant-fixture';

/**
 * HTTP e2e — Đợt 4 SaaS (docs/DECISIONS.md #237): nhận biết công ty theo tên miền phụ, cô lập giữa các công ty, khu quản trị nền tảng (đăng nhập mật khẩu + OTP, tạo công ty,
 * khoá/mở khoá, đặt lại mật khẩu quản trị, nhật ký). Biến môi trường đặt TRƯỚC khi nạp `AppModule` (ConfigModule đọc một lần), mỗi chế độ một ứng dụng riêng.
 * Tên miền phụ giả lập bằng header `Host` (supertest).
 */
const BASE = 'nexamed.test';
const PASSWORD = 'Test@12345';

async function bootstrap(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  const { AppModule } = await import('../../app.module');
  const { PlatformAuthService } = await import('./platform-auth.service');
  // Giới hạn tần suất đăng nhập theo IP (10 lần/phút/đường dẫn) không phải đối tượng của spec này — mọi request test cùng một IP 127.0.0.1.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());
  await app.init();
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  await privileged.$connect();
  const fixture = await createTwoTenantFixture(privileged, 'SaaS e2e');
  await seedPermissionCatalog(privileged);
  const restoreEnv = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  return { app, privileged, fixture, restoreEnv, platformAuth: app.get(PlatformAuthService) };
}

/** Gọi API với một tên miền phụ giả lập. */
function api(app: INestApplication, host: string) {
  const http = () => request(app.getHttpServer());
  const set = (r: request.Test, token?: string, cookie?: string) => {
    r.set('Host', host);
    if (token) r.set('Authorization', `Bearer ${token}`);
    if (cookie) r.set('Cookie', cookie);
    return r;
  };
  return {
    get: (path: string, token?: string) => set(http().get(`/api/v1${path}`), token),
    post: (path: string, body?: object, token?: string, cookie?: string) => set(http().post(`/api/v1${path}`).send(body ?? {}), token, cookie),
    patch: (path: string, body: object, token?: string) => set(http().patch(`/api/v1${path}`).send(body), token),
  };
}

function refreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('refresh_token='));
  if (!cookie) throw new Error('Không có cookie refresh_token trong phản hồi đăng nhập');
  return cookie.split(';')[0]!;
}

describe('HTTP e2e — SaaS: tên miền phụ, cô lập công ty, khu quản trị nền tảng', () => {
  let ctx: Awaited<ReturnType<typeof bootstrap>>;
  let fixture: TwoTenantFixture;
  const suffix = randomBytes(4).toString('hex');
  const codeA = `ta-${suffix}`;
  const codeB = `tb-${suffix}`;
  const codeC = `tc-${suffix}`;
  const hostA = `${codeA}.${BASE}`;
  const hostB = `${codeB}.${BASE}`;
  const hostC = `${codeC}.${BASE}`;
  const codeD = `td-${suffix}`;
  const hostD = `${codeD}.${BASE}`;
  const adminHost = `admin.${BASE}`;
  const operatorIds: string[] = [];
  let usernameA: string;
  let usernameB: string;
  let operatorUsername: string;
  let operatorSecret: string;
  let platformToken: string;
  let tenantCId: string;
  let tenantDId: string;
  let tenantCVersion: number;
  let adminCUsername: string;
  let tempPasswordC: string;

  const A = () => api(ctx.app, hostA);
  const B = () => api(ctx.app, hostB);
  const C = () => api(ctx.app, hostC);
  const P = () => api(ctx.app, adminHost);

  async function createOperator(label: string): Promise<{ id: string; username: string; secret: string }> {
    const username = `op-${label}-${randomUUID().slice(0, 8)}`;
    const secret = generateTotpSecret();
    const op = await ctx.privileged.platformOperator.create({
      data: { username, fullName: `Vận hành ${label}`, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), totpSecretEnc: encryptPii(secret, process.env.ENCRYPTION_KEY!).toString('base64') },
    });
    operatorIds.push(op.id);
    return { id: op.id, username, secret };
  }

  async function clinicLogin(client: ReturnType<typeof api>, tenantId: string, username: string, password = PASSWORD) {
    const res = await client.post('/auth/login', { tenantId, username, password });
    return { res, token: res.body?.data?.accessToken as string | undefined, cookie: res.status === 200 ? refreshCookie(res) : undefined };
  }

  beforeAll(async () => {
    ctx = await bootstrap({ DEPLOYMENT_MODE: 'saas', PLATFORM_BASE_DOMAIN: BASE, PLATFORM_ADMIN_SUBDOMAIN: 'admin', COOKIE_SECURE: 'false' });
    fixture = ctx.fixture;
    for (const [tenantId, code] of [[fixture.tenantA.id, codeA], [fixture.tenantB.id, codeB]] as const) {
      await ctx.privileged.tenant.update({ where: { id: tenantId }, data: { code } });
      await seedDefaultRolesForTenant(ctx.privileged, tenantId, '00000000-0000-0000-0000-000000000000');
    }
    const helpers = createE2eHelpers({ app: () => ctx.app, privileged: () => ctx.privileged });
    usernameA = (await helpers.createUser(fixture.tenantA.id, { name: 'clinic_admin' }, 'saas-a')).username;
    usernameB = (await helpers.createUser(fixture.tenantB.id, { name: 'clinic_admin' }, 'saas-b')).username;
    const op = await createOperator('chinh');
    operatorUsername = op.username;
    operatorSecret = op.secret;
  }, 90_000);

  afterAll(async () => {
    await ctx.privileged.tenantCodeAlias.deleteMany({ where: { targetTenantId: { in: [fixture.tenantA.id, fixture.tenantB.id, ...(tenantCId ? [tenantCId] : []), ...(tenantDId ? [tenantDId] : [])] } } });
    await ctx.privileged.platformAuditLog.deleteMany({ where: { OR: [{ operatorId: { in: operatorIds } }, { targetTenantId: { in: [fixture.tenantA.id, fixture.tenantB.id, ...(tenantCId ? [tenantCId] : []), ...(tenantDId ? [tenantDId] : [])] } }] } });
    await ctx.fixture.cleanup();
    await ctx.privileged.platformOperator.deleteMany({ where: { id: { in: operatorIds } } });
    await ctx.privileged.$disconnect();
    await ctx.app.close();
    ctx.restoreEnv();
  }, 90_000);

  // ---- Nhận biết công ty theo tên miền phụ ----
  it('tra công ty theo tên miền phụ: công ty, khu quản trị, tên lạ, tên miền khác', async () => {
    const a = await A().get('/public/tenant-context');
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.data).toMatchObject({ kind: 'tenant', tenantId: fixture.tenantA.id, code: codeA, suspended: false });
    expect(Object.keys(a.body.data).sort()).toEqual(['code', 'kind', 'name', 'suspended', 'tenantId']);

    expect((await P().get('/public/tenant-context')).body.data).toEqual({ kind: 'platform' });

    const unknown = await api(ctx.app, `khong-co-${suffix}.${BASE}`).get('/public/tenant-context');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('TENANT_NOT_FOUND');
    expect((await api(ctx.app, 'example.com').get('/public/tenant-context')).status).toBe(404);
  });

  // ---- Cô lập: đăng nhập, token, làm mới phiên chỉ đúng công ty của tên miền ----
  it('đăng nhập chỉ đúng công ty của tên miền phụ; gửi tenantId của công ty khác → 404', async () => {
    const wrong = await clinicLogin(A(), fixture.tenantB.id, usernameB);
    expect(wrong.res.status).toBe(404);
    expect(wrong.res.body.error.code).toBe('TENANT_NOT_FOUND');
    const wrongHost = await clinicLogin(api(ctx.app, adminHost), fixture.tenantA.id, usernameA);
    expect(wrongHost.res.status).toBe(404);
  });

  it('token và cookie làm mới của công ty A không dùng được ở tên miền công ty B hay khu quản trị', async () => {
    const a = await clinicLogin(A(), fixture.tenantA.id, usernameA);
    expect(a.res.status, JSON.stringify(a.res.body)).toBe(200);
    expect((await A().get('/auth/me', a.token)).status).toBe(200);
    expect((await B().get('/auth/me', a.token)).status).toBe(401);
    expect((await P().get('/auth/me', a.token)).status).toBe(401);
    // Làm mới phiên đúng tên miền thì được, sai tên miền thì bị từ chối.
    expect((await B().post('/auth/refresh', {}, undefined, a.cookie)).status).toBe(401);
    expect((await A().post('/auth/refresh', {}, undefined, a.cookie)).status).toBe(200);
  });

  // ---- Khu quản trị: đăng nhập mật khẩu + OTP ----
  it('khu quản trị chỉ tồn tại ở tên miền quản trị: tên miền công ty và tên miền lạ trả 404', async () => {
    expect((await A().post('/platform/auth/login', { username: 'x', password: 'y' })).status).toBe(404);
    expect((await A().get('/platform/tenants')).status).toBe(404);
    expect((await api(ctx.app, 'example.com').get('/platform/tenants')).status).toBe(404);
    expect((await P().get('/platform/tenants')).status).toBe(401);
  });

  it('đăng nhập vận hành: sai mật khẩu 401, mã tạm không phải access token, sai OTP 401, đúng OTP vào được', async () => {
    expect((await P().post('/platform/auth/login', { username: operatorUsername, password: 'sai-mat-khau' })).status).toBe(401);
    const step1 = await P().post('/platform/auth/login', { username: operatorUsername, password: PASSWORD });
    expect(step1.status).toBe(200);
    const mfa = step1.body.data.mfaToken as string;
    expect((await P().get('/platform/tenants', mfa)).status).toBe(401);
    const wrongCode = totpAt(operatorSecret, Date.now() + 10 * 60_000);
    expect((await P().post('/platform/auth/verify-otp', { mfaToken: mfa, code: wrongCode })).status).toBe(401);
    const ok = await P().post('/platform/auth/verify-otp', { mfaToken: mfa, code: totpAt(operatorSecret, Date.now()) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    platformToken = ok.body.data.accessToken;
    expect((await P().get('/platform/auth/me', platformToken)).body.data).toMatchObject({ username: operatorUsername });
  });

  it('token vận hành không dùng được cho API phòng khám và ngược lại', async () => {
    expect((await A().get('/auth/me', platformToken)).status).toBe(401);
    const a = await clinicLogin(A(), fixture.tenantA.id, usernameA);
    expect((await P().get('/platform/tenants', a.token)).status).toBe(401);
    // Đúng tên miền công ty + token vận hành: khu quản trị vẫn 404 (không phải tên miền quản trị).
    expect((await A().get('/platform/tenants', platformToken)).status).toBe(404);
  });

  it('khoá tạm người vận hành sau 5 lần sai (gọi thẳng service, không qua giới hạn tần suất theo IP)', async () => {
    const op = await createOperator('khoa');
    for (let i = 0; i < 5; i += 1) {
      await expect(ctx.platformAuth.login({ username: op.username, password: 'sai' }, { ip: null, userAgent: null })).rejects.toThrow();
    }
    await expect(ctx.platformAuth.login({ username: op.username, password: PASSWORD }, { ip: null, userAgent: null })).rejects.toBeInstanceOf(AccountLockedError);
  });

  // ---- Tạo công ty ----
  it('tạo công ty: mã sai định dạng/dành riêng 422, trùng 409, thành công trả mật khẩu tạm và đăng nhập được đúng tên miền', async () => {
    const base = { name: 'Phòng khám Cô lập C', contactName: 'Liên hệ C', contactPhone: '0900000003', adminFullName: 'Quản trị C', adminUsername: 'quantri-c' };
    expect((await P().post('/platform/tenants', { ...base, code: 'admin' }, platformToken)).status).toBe(422);
    expect((await P().post('/platform/tenants', { ...base, code: 'ab' }, platformToken)).status).toBe(422);
    expect((await P().post('/platform/tenants', { ...base, code: 'Co Dau' }, platformToken)).status).toBe(422);
    const dup = await P().post('/platform/tenants', { ...base, code: codeA }, platformToken);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PLATFORM_TENANT_CODE_TAKEN');

    const created = await P().post('/platform/tenants', { ...base, code: codeC.toUpperCase(), operatorNote: 'Đã chuyển khoản' }, platformToken);
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    tenantCId = created.body.data.tenant.id;
    fixture.trackTenant(tenantCId);
    tenantCVersion = created.body.data.tenant.version;
    adminCUsername = created.body.data.adminUsername;
    tempPasswordC = created.body.data.temporaryPassword;
    expect(created.body.data.tenant).toMatchObject({ code: codeC, status: 'active', loginUrl: `https://${hostC}`, activeUserCount: 1, branchCount: 1, operatorNote: 'Đã chuyển khoản' });
    expect(tempPasswordC).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

    // Mật khẩu tạm không được lưu dạng đọc được.
    const stored = await ctx.privileged.userAccount.findFirstOrThrow({ where: { tenantId: tenantCId, username: adminCUsername } });
    expect(stored.passwordHash).not.toContain(tempPasswordC);
    expect(stored.mustChangePassword).toBe(true);

    const login = await clinicLogin(C(), tenantCId, adminCUsername, tempPasswordC);
    expect(login.res.status, JSON.stringify(login.res.body)).toBe(200);
    expect(login.res.body.data.user.mustChangePassword).toBe(true);
    expect((await clinicLogin(A(), tenantCId, adminCUsername, tempPasswordC)).res.status).toBe(404);
  }, 120_000);

  it('danh sách + chi tiết: chỉ số đếm vận hành, lọc theo trạng thái và từ khoá, không có dữ liệu bệnh nhân', async () => {
    const list = await P().get(`/platform/tenants?q=${codeC}`, platformToken);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({ id: tenantCId, code: codeC, status: 'active' });
    expect(list.body.data.stats.total).toBeGreaterThanOrEqual(3);
    expect(list.body.data.stats.createdLast30Days).toBeGreaterThanOrEqual(3);
    expect((await P().get('/platform/tenants?status=suspended&q=' + codeC, platformToken)).body.data.items).toHaveLength(0);

    const detail = await P().get(`/platform/tenants/${tenantCId}`, platformToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data.lastLoginAt).not.toBeNull();
    const keys = Object.keys(detail.body.data);
    expect(keys.filter((k) => /patient|encounter|revenue|invoice/i.test(k))).toEqual([]);
    expect((await P().get(`/platform/tenants/${randomUUID()}`, platformToken)).status).toBe(404);
  });

  it('sửa thông tin liên hệ: khoá lạc quan theo version', async () => {
    const body = { contactName: 'Người mới', contactPhone: '0911111111', contactEmail: 'moi@example.vn', operatorNote: 'Gia hạn 3 tháng' };
    expect((await P().patch(`/platform/tenants/${tenantCId}`, { ...body, version: tenantCVersion + 5 }, platformToken)).status).toBe(409);
    const ok = await P().patch(`/platform/tenants/${tenantCId}`, { ...body, version: tenantCVersion }, platformToken);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ contactName: 'Người mới', version: tenantCVersion + 1 });
    tenantCVersion = ok.body.data.version;
  });

  // ---- Khoá / mở khoá ----
  it('khoá công ty: bắt buộc lý do; token đang cầm, làm mới phiên và đăng nhập mới đều bị chặn; mở khoá thì dùng lại', async () => {
    const before = await clinicLogin(C(), tenantCId, adminCUsername, tempPasswordC);
    expect(before.res.status).toBe(200);

    expect((await P().post(`/platform/tenants/${tenantCId}/suspend`, { version: tenantCVersion }, platformToken)).status).toBe(400);
    expect((await P().post(`/platform/tenants/${tenantCId}/suspend`, { version: tenantCVersion + 3, reason: 'Quá hạn cước tháng 10' }, platformToken)).status).toBe(409);
    const suspended = await P().post(`/platform/tenants/${tenantCId}/suspend`, { version: tenantCVersion, reason: 'Quá hạn cước tháng 10' }, platformToken);
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    expect(suspended.body.data).toMatchObject({ status: 'suspended', suspendedReason: 'Quá hạn cước tháng 10', suspendedByName: 'Vận hành chinh' });
    tenantCVersion = suspended.body.data.version;

    // Đăng xuất ngay: token đang cầm bị chặn, phiên làm mới bị thu hồi, đăng nhập mới bị từ chối.
    expect((await C().get('/auth/me', before.token)).status).toBe(401);
    const refresh = await C().post('/auth/refresh', {}, undefined, before.cookie);
    expect([401, 403]).toContain(refresh.status);
    const login = await clinicLogin(C(), tenantCId, adminCUsername, tempPasswordC);
    expect(login.res.status).toBe(403);
    expect(login.res.body.error.code).toBe('TENANT_SUSPENDED');
    expect((await C().get('/public/tenant-context')).body.data.suspended).toBe(true);
    expect(await ctx.privileged.userSession.count({ where: { tenantId: tenantCId, deletedAt: null } })).toBe(0);

    // Công ty khác không bị ảnh hưởng.
    expect((await clinicLogin(A(), fixture.tenantA.id, usernameA)).res.status).toBe(200);

    expect((await P().post(`/platform/tenants/${tenantCId}/suspend`, { version: tenantCVersion, reason: 'Khoá lần hai' }, platformToken)).status).toBe(409);
    expect((await P().post(`/platform/tenants/${tenantCId}/unsuspend`, { version: tenantCVersion + 3 }, platformToken)).status).toBe(409);
    const open = await P().post(`/platform/tenants/${tenantCId}/unsuspend`, { version: tenantCVersion }, platformToken);
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    expect(open.body.data).toMatchObject({ status: 'active', suspendedReason: null });
    tenantCVersion = open.body.data.version;
    expect((await P().post(`/platform/tenants/${tenantCId}/unsuspend`, { version: tenantCVersion }, platformToken)).status).toBe(409);
    expect((await clinicLogin(C(), tenantCId, adminCUsername, tempPasswordC)).res.status).toBe(200);
  }, 60_000);

  it('đặt lại mật khẩu quản trị: mật khẩu cũ hết hiệu lực, phiên cũ bị thu hồi, buộc đổi ở lần đăng nhập đầu', async () => {
    const old = await clinicLogin(C(), tenantCId, adminCUsername, tempPasswordC);
    expect(old.res.status).toBe(200);
    const reset = await P().post(`/platform/tenants/${tenantCId}/reset-admin-password`, {}, platformToken);
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect(reset.body.data).toMatchObject({ adminUsername: adminCUsername });
    expect(reset.body.data.temporaryPassword).not.toBe(tempPasswordC);

    expect((await C().post('/auth/refresh', {}, undefined, old.cookie)).status).toBe(401);
    expect((await clinicLogin(C(), tenantCId, adminCUsername, tempPasswordC)).res.status).toBe(401);
    const fresh = await clinicLogin(C(), tenantCId, adminCUsername, reset.body.data.temporaryPassword);
    expect(fresh.res.status).toBe(200);
    expect(fresh.res.body.data.user.mustChangePassword).toBe(true);
  }, 60_000);


  // ---- Chống dùng lại mã OTP (RFC 6238 mục 5.2, docs/DECISIONS.md #244) ----
  it('mã OTP chỉ dùng MỘT lần: dùng lại cùng mã, hoặc mã của bước cũ hơn, đều bị từ chối như mã sai; mã của bước mới hơn vào được', async () => {
    const op = await createOperator('otp-mot-lan');
    const loginMfa = async () => (await P().post('/platform/auth/login', { username: op.username, password: PASSWORD })).body.data.mfaToken as string;
    const verify = (mfaToken: string, code: string) => P().post('/platform/auth/verify-otp', { mfaToken, code });
    const now = Date.now();
    const current = totpAt(op.secret, now);
    const previous = totpAt(op.secret, now - 30_000);
    const next = totpAt(op.secret, now + 30_000);

    const mfa = await loginMfa();
    const first = await verify(mfa, current);
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    // Kẻ lấy được mã (lừa đảo/nhìn trộm) dùng lại ngay trong cửa sổ ~90 giây: bị chặn, thông báo Y HỆT mã sai để không lộ "mã đã đúng".
    const replay = await verify(await loginMfa(), current);
    expect(replay.status).toBe(401);
    const wrong = await verify(await loginMfa(), totpAt(op.secret, now + 10 * 60_000));
    expect(replay.body.error.code).toBe(wrong.body.error.code);
    expect(replay.body.error.message).toBe(wrong.body.error.message);

    // Mã của bước CŨ hơn bước đã dùng cũng không được chấp nhận (bước chỉ được đi tới).
    expect((await verify(await loginMfa(), previous)).status).toBe(401);

    // Mã của bước kế tiếp thì vào được — người vận hành thật chỉ cần chờ tối đa một bước.
    expect((await verify(await loginMfa(), next)).status).toBe(200);

    const audit = await ctx.privileged.platformAuditLog.count({ where: { operatorId: op.id, action: 'platform.otp_replay_blocked' } });
    expect(audit).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('hai yêu cầu gửi CÙNG một mã cùng lúc: chỉ một yêu cầu qua (cập nhật có điều kiện, không đọc-rồi-ghi)', async () => {
    const op = await createOperator('otp-song-song');
    const code = totpAt(op.secret, Date.now());
    const mfaTokens = await Promise.all(
      [1, 2, 3, 4].map(async () => (await P().post('/platform/auth/login', { username: op.username, password: PASSWORD })).body.data.mfaToken as string),
    );
    const results = await Promise.all(mfaTokens.map((mfaToken) => P().post('/platform/auth/verify-otp', { mfaToken, code })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(3);
  }, 60_000);

  // ---- Đổi MÃ công ty (docs/DECISIONS.md #245) ----
  it('đổi mã công ty: kiểm tra đầu vào, giữ mã cũ làm lối tắt chuyển hướng, thu hồi phiên, không cấp lại mã cũ, DB vẫn chặn đổi tay', async () => {
    // Công ty RIÊNG cho test này (giới hạn đăng nhập tính theo IP + công ty).
    const baseD = { name: 'Phòng khám Đổi mã D', contactName: 'Liên hệ D', contactPhone: '0900000004', adminFullName: 'Quản trị D', adminUsername: 'quantri-d' };
    const createdD = await P().post('/platform/tenants', { ...baseD, code: codeD }, platformToken);
    expect(createdD.status, JSON.stringify(createdD.body)).toBe(200);
    tenantDId = createdD.body.data.tenant.id;
    fixture.trackTenant(tenantDId);
    const tempPasswordD = createdD.body.data.temporaryPassword as string;
    const D = () => api(ctx.app, hostD);
    const detail = async () => (await P().get(`/platform/tenants/${tenantDId}`, platformToken)).body.data as { version: number; code: string };
    const change = (body: object) => P().post(`/platform/tenants/${tenantDId}/change-code`, body, platformToken);
    const newCode = `tn-${suffix}`;
    const newHost = `${newCode}.${BASE}`;

    // Có phiên đang mở để kiểm tra việc thu hồi.
    const currentPassword = tempPasswordD;
    const sessionLogin = await clinicLogin(D(), tenantDId, 'quantri-d', currentPassword);
    expect(sessionLogin.res.status).toBe(200);

    let v = (await detail()).version;
    // Đầu vào sai.
    expect((await change({ version: v, newCode: 'admin', reason: 'Đổi thương hiệu' })).status).toBe(422); // dành riêng
    expect((await change({ version: v, newCode: 'Co Dau', reason: 'Đổi thương hiệu' })).status).toBe(422); // sai định dạng
    const same = await change({ version: v, newCode: codeD, reason: 'Đổi thương hiệu' });
    expect(same.status).toBe(422);
    expect(same.body.error.code).toBe('PLATFORM_TENANT_CODE_UNCHANGED');
    expect((await change({ version: v, newCode: codeA, reason: 'Đổi thương hiệu' })).status).toBe(409); // công ty khác đang dùng
    expect((await change({ version: v, newCode })).status).toBe(400); // thiếu lý do
    expect((await change({ version: v + 5, newCode, reason: 'Đổi thương hiệu' })).status).toBe(409); // sai phiên bản
    expect((await detail()).code).toBe(codeD); // chưa đổi gì

    const ok = await change({ version: v, newCode, reason: 'Khách đổi tên thương hiệu' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.tenant).toMatchObject({ code: newCode, loginUrl: `https://${newHost}` });
    expect(ok.body.data.revokedSessionCount).toBeGreaterThanOrEqual(1);
    const days = (new Date(ok.body.data.oldCodeValidUntil).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThanOrEqual(90);
    v = ok.body.data.tenant.version;

    // Tên miền MỚI hoạt động đầy đủ; tên miền CŨ chỉ dùng để chuyển hướng.
    const N = () => api(ctx.app, newHost);

    // Phiên cũ bị thu hồi: làm mới phiên thất bại ở tên miền mới (401); ở tên miền cũ thì không còn là công ty nào (404).
    expect((await N().post('/auth/refresh', {}, undefined, sessionLogin.cookie)).status).toBe(401);
    expect((await D().post('/auth/refresh', {}, undefined, sessionLogin.cookie)).status).toBe(404);
    // Chỉ còn phiên của lần đăng nhập lại ở tên miền mới (xem bên dưới) — phiên cũ đã bị thu hồi hết.
    expect(await ctx.privileged.userSession.count({ where: { tenantId: tenantDId, deletedAt: null } })).toBe(0);

    expect((await N().get('/public/tenant-context')).body.data).toMatchObject({ kind: 'tenant', code: newCode });
    expect((await clinicLogin(N(), tenantDId, 'quantri-d', currentPassword)).res.status).toBe(200); // đăng nhập lại ở địa chỉ mới
    const moved = await D().get('/public/tenant-context');
    expect(moved.status).toBe(200);
    expect(moved.body.data).toEqual({ kind: 'moved', loginUrl: `https://${newHost}` });
    expect((await clinicLogin(D(), tenantDId, 'quantri-d', currentPassword)).res.status).toBe(404); // đăng nhập KHÔNG qua tên miền cũ

    // Mã cũ được GIỮ CHỖ: không cấp cho công ty mới, không cho công ty khác đổi sang.
    const base = { name: 'Phòng khám chiếm tên cũ', contactName: 'Liên hệ', contactPhone: '0900000009', adminFullName: 'Quản trị', adminUsername: 'quantri-x' };
    const squat = await P().post('/platform/tenants', { ...base, code: codeD }, platformToken);
    expect(squat.status).toBe(409);
    expect(squat.body.error.code).toBe('PLATFORM_TENANT_CODE_RESERVED');

    // Đổi lần nữa: lối tắt của mã đầu tiên vẫn dẫn tới mã MỚI NHẤT (đi theo công ty, không theo mã trung gian).
    const third = `tt-${suffix}`;
    const again = await change({ version: v, newCode: third, reason: 'Đổi lần hai' });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await D().get('/public/tenant-context')).body.data).toEqual({ kind: 'moved', loginUrl: `https://${third}.${BASE}` });
    expect((await N().get('/public/tenant-context')).body.data).toEqual({ kind: 'moved', loginUrl: `https://${third}.${BASE}` });
    // Trả về đúng mã đang giữ chỗ của chính mình cũng không được (tránh vòng lặp lối tắt).
    const back = await change({ version: again.body.data.tenant.version, newCode: codeD, reason: 'Quay lại' });
    expect(back.status).toBe(409);

    // Chốt chặn ở CƠ SỞ DỮ LIỆU: vẫn không đổi được mã bằng lệnh UPDATE thường, kể cả có quyền cao.
    await expect(ctx.privileged.tenant.update({ where: { id: tenantDId }, data: { code: `tay-${suffix}` } })).rejects.toThrow(/không được đổi/);
    // Và vẫn không thể đặt mã về rỗng bằng đường đổi mã.
    expect((await detail()).code).toBe(third);

    // Lối tắt HẾT HẠN thì tắt: tên miền cũ không còn chuyển hướng, và mã cũ được cấp lại cho công ty khác.
    await ctx.privileged.tenantCodeAlias.updateMany({ where: { targetTenantId: tenantDId, oldCode: codeD }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const expired = await D().get('/public/tenant-context');
    expect(expired.status).toBe(404);
    expect(expired.body.error.code).toBe('TENANT_NOT_FOUND');
    const reuse = await P().post('/platform/tenants', { ...base, code: codeD, adminUsername: 'quantri-e' }, platformToken);
    expect(reuse.status, JSON.stringify(reuse.body)).toBe(200);
    fixture.trackTenant(reuse.body.data.tenant.id as string);
    // Mã trung gian vẫn còn lối tắt (chưa hết hạn) nên vẫn dẫn tới mã mới nhất.
    expect((await N().get('/public/tenant-context')).body.data).toMatchObject({ kind: 'moved' });

    const alias = await ctx.privileged.tenantCodeAlias.findMany({ where: { targetTenantId: tenantDId }, orderBy: { createdAt: 'asc' } });
    expect(alias.map((a) => [a.oldCode, a.newCode])).toEqual([[codeD, newCode], [newCode, third]]);
    expect(alias[0]!.reason).toBe('Khách đổi tên thương hiệu');

    const logs = await P().get(`/platform/audit-logs?tenantId=${tenantDId}`, platformToken);
    const entries = logs.body.data.items.filter((i: { action: string }) => i.action === 'platform.tenant_code_changed') as { actionLabel: string; note: string }[];
    expect(entries).toHaveLength(2); // hai lần đổi mã thành công (các lần bị từ chối KHÔNG ghi)
    expect(entries.every((e) => e.actionLabel === 'Đổi mã tên miền của công ty')).toBe(true);
    // Nhật ký ghi cả mã cũ → mã mới lẫn LÝ DO của từng lần.
    expect(entries.map((e) => e.note).sort()).toEqual([`${newCode} → ${third}: Đổi lần hai`, `${codeD} → ${newCode}: Khách đổi tên thương hiệu`].sort());
  }, 120_000);

  it('nhật ký vận hành: ghi đủ thao tác kèm lý do, lọc theo công ty, không chứa mật khẩu', async () => {
    const res = await P().get(`/platform/audit-logs?tenantId=${tenantCId}`, platformToken);
    expect(res.status).toBe(200);
    const labels = res.body.data.items.map((i: { actionLabel: string }) => i.actionLabel);
    expect(labels).toEqual(expect.arrayContaining(['Tạo công ty và tài khoản quản trị đầu tiên', 'Sửa thông tin liên hệ', 'Khoá công ty', 'Mở khoá công ty', 'Đặt lại mật khẩu quản trị']));
    const locked = res.body.data.items.find((i: { action: string }) => i.action === 'platform.tenant_suspended');
    expect(locked).toMatchObject({ note: 'Quá hạn cước tháng 10', operatorName: 'Vận hành chinh', targetTenantName: 'Phòng khám Cô lập C' });
    expect(JSON.stringify(res.body)).not.toContain(tempPasswordC);
    const all = await P().get('/platform/audit-logs?limit=2', platformToken);
    expect(all.body.data.items).toHaveLength(2);
    expect(all.body.data.nextCursor).not.toBeNull();
  });
});

describe('HTTP e2e — chế độ một công ty không đổi', () => {
  it('đăng nhập không phụ thuộc tên miền; khu quản trị và tra công ty theo tên miền không tồn tại (404)', async () => {
    const ctx = await bootstrap({ DEPLOYMENT_MODE: 'single', PLATFORM_BASE_DOMAIN: undefined, COOKIE_SECURE: 'false' });
    try {
      await seedDefaultRolesForTenant(ctx.privileged, ctx.fixture.tenantA.id, '00000000-0000-0000-0000-000000000000');
      const helpers = createE2eHelpers({ app: () => ctx.app, privileged: () => ctx.privileged });
      const user = await helpers.createUser(ctx.fixture.tenantA.id, { name: 'clinic_admin' }, 'single');
      const anywhere = api(ctx.app, 'may-chu-noi-bo.local');
      const login = await anywhere.post('/auth/login', { tenantId: ctx.fixture.tenantA.id, username: user.username, password: PASSWORD });
      expect(login.status, JSON.stringify(login.body)).toBe(200);
      const token = login.body.data.accessToken as string;
      expect((await anywhere.get('/auth/me', token)).status).toBe(200);
      for (const path of ['/public/tenant-context', '/platform/tenants', '/platform/audit-logs']) {
        expect((await anywhere.get(path, token)).status, path).toBe(404);
      }
      expect((await anywhere.post('/platform/auth/login', { username: 'x', password: 'y' })).status).toBe(404);
    } finally {
      await ctx.fixture.cleanup();
      await ctx.privileged.$disconnect();
      await ctx.app.close();
      ctx.restoreEnv();
    }
  }, 90_000);
});
