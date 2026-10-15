import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { softwareUpdateStatusSchema } from '@nexamed/shared';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createE2eHelpers } from '../../testing/e2e-helpers';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e — `/api/v1/system/update/*` (kiểm tra cập nhật phần mềm, docs/DECISIONS.md #236 bước 2). Máy chủ phát hành là một máy chủ HTTP giả chạy ngay trong test.
 * Biến môi trường phải đặt TRƯỚC khi nạp `AppModule` (ConfigModule đọc một lần lúc nạp) nên mỗi cấu hình là một ứng dụng riêng, nạp lại module qua `vi.resetModules()`.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const entry = (version: string, extra: Record<string, unknown> = {}) => ({
  version,
  releasedAt: '2026-10-20',
  notes: { features: ['Tính năng mới'], improvements: [], fixes: [] },
  requiresMigration: false,
  ...extra,
});
const manifest = (stable?: unknown, beta?: unknown) => ({ schemaVersion: 1, channels: { ...(stable ? { stable } : {}), ...(beta ? { beta } : {}) } });

async function bootstrap(env: Record<string, string | undefined>, label: string) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  const { AppModule } = await import('../../app.module');
  const { SoftwareUpdateService } = await import('./software-update.service');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());
  await app.init();
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  await privileged.$connect();
  const fixture = await createTwoTenantFixture(privileged, label);
  await seedPermissionCatalog(privileged);
  await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
  await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
  const helpers = createE2eHelpers({ app: () => app, privileged: () => privileged });
  const tokenFor = async (tenantId: string, roleName: string) => {
    const user = await helpers.createUser(tenantId, { name: roleName }, `swupdate-${roleName}`);
    return helpers.login(tenantId, user.username);
  };
  const close = async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  return { app, privileged, fixture, helpers, tokenFor, close, service: app.get(SoftwareUpdateService) };
}

describe('HTTP e2e — Cập nhật phần mềm (một công ty, đã cấu hình máy chủ phát hành)', () => {
  let ctx: Awaited<ReturnType<typeof bootstrap>>;
  let server: Server;
  let handler: Handler = (_req, res) => json(res, manifest());
  let adminToken: string;
  let adminBToken: string;
  const get = (token: string) => request(ctx.app.getHttpServer()).get('/api/v1/system/update/status').set({ Authorization: `Bearer ${token}` });
  const check = (token: string) => request(ctx.app.getHttpServer()).post('/api/v1/system/update/check').set({ Authorization: `Bearer ${token}` });
  const auditCount = () => ctx.privileged.auditLog.count({ where: { tenantId: ctx.fixture.tenantA.id, action: 'software_update.checked' } });

  beforeAll(async () => {
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    ctx = await bootstrap({ APP_VERSION: '0.9.0', BUILD_ID: '127', RELEASE_CHANNEL: 'stable', DEPLOYMENT_MODE: 'single', RELEASE_SERVER_URL: `http://127.0.0.1:${port}` }, 'Software update e2e');
    adminToken = await ctx.tokenFor(ctx.fixture.tenantA.id, 'clinic_admin');
    adminBToken = await ctx.tokenFor(ctx.fixture.tenantB.id, 'clinic_admin');
  }, 60_000);

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ctx.close();
  });

  it('chưa kiểm lần nào: never_checked, đúng hợp đồng dùng chung, có hiển thị máy chủ phát hành', async () => {
    const res = await get(adminToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(softwareUpdateStatusSchema.safeParse(res.body.data).success).toBe(true);
    expect(res.body.data).toMatchObject({ state: 'never_checked', configured: true, currentVersion: '0.9.0', channel: 'stable', latest: null, history: [] });
    expect(res.body.data.releaseServerUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('có bản mới: update_available kèm ghi chú, cảnh báo migration và bản trung gian', async () => {
    handler = (_req, res) => json(res, manifest(entry('1.2.0', { requiresMigration: true, minimumFromVersion: '1.0.0' })));
    const res = await check(adminToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ state: 'update_available', needsIntermediateVersion: true, errorMessage: null });
    expect(res.body.data.latest).toMatchObject({ version: '1.2.0', requiresMigration: true });
    expect(res.body.data.lastCheckedAt).not.toBeNull();
  });

  it('bản trên máy chủ không mới hơn (hoặc kênh trống) → up_to_date', async () => {
    handler = (_req, res) => json(res, manifest(entry('0.9.0')));
    expect((await check(adminToken)).body.data.state).toBe('up_to_date');
    handler = (_req, res) => json(res, manifest());
    expect((await check(adminToken)).body.data.state).toBe('up_to_date');
  });

  it('kênh Ổn định bỏ qua bản beta trong cùng file khai báo', async () => {
    handler = (_req, res) => json(res, manifest(undefined, entry('9.9.9-beta.1')));
    expect((await check(adminToken)).body.data.state).toBe('up_to_date');
  });

  it('máy chủ phát hành lỗi hoặc trả dữ liệu hỏng: state=error + thông báo tiếng Việt, API vẫn 200', async () => {
    const cases: Array<[string, Handler]> = [
      ['JSON hỏng', (_req, res) => { res.writeHead(200); res.end('{không phải json'); }],
      ['sai cấu trúc', (_req, res) => json(res, { schemaVersion: 2, channels: {} })],
      ['phiên bản sai SemVer', (_req, res) => json(res, manifest(entry('phien-ban-la')))],
      ['404', (_req, res) => json(res, { message: 'không có' }, 404)],
      ['chuyển hướng', (_req, res) => { res.writeHead(302, { location: '/o-dau-do' }); res.end(); }],
      ['quá lớn', (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('x'.repeat(300 * 1024)); }],
    ];
    for (const [name, h] of cases) {
      handler = h;
      const res = await check(adminToken);
      expect(res.status, name).toBe(200);
      expect(res.body.data.state, name).toBe('error');
      expect(res.body.data.errorMessage, name).toMatch(/máy chủ phát hành/i);
      expect(res.body.data.latest, name).toBeNull();
    }
  });

  it('máy chủ phát hành không trả lời kịp: hết thời gian chờ, báo lỗi', async () => {
    handler = () => {
      /* không trả lời */
    };
    const res = await check(adminToken);
    expect(res.body.data.state).toBe('error');
    expect(res.body.data.errorMessage).toContain('không trả lời');
  }, 20_000);

  it('mỗi lần "Kiểm tra ngay" ghi nhật ký; lịch sử có tên người, mới nhất trước, tối đa 5 dòng', async () => {
    handler = (_req, res) => json(res, manifest(entry('0.10.0')));
    const before = await auditCount();
    await check(adminToken);
    expect(await auditCount()).toBe(before + 1);
    const res = await get(adminToken);
    expect(res.body.data.history.length).toBeLessThanOrEqual(5);
    expect(res.body.data.history[0]).toMatchObject({ byName: 'User swupdate-clinic_admin', result: 'update_available', latestVersion: '0.10.0' });
  });

  it('kiểm định kỳ ở nền KHÔNG ghi nhật ký nhưng cập nhật trạng thái', async () => {
    handler = (_req, res) => json(res, manifest(entry('0.9.0')));
    await check(adminToken);
    handler = (_req, res) => json(res, manifest(entry('3.0.0')));
    const before = await auditCount();
    await ctx.service.runBackgroundCheck();
    expect(await auditCount()).toBe(before);
    expect((await get(adminToken)).body.data).toMatchObject({ state: 'update_available' });
  });

  it('cách ly công ty: lịch sử kiểm tra của công ty A không hiện ở công ty B', async () => {
    expect((await get(adminBToken)).body.data.history).toEqual([]);
    expect(await ctx.privileged.auditLog.count({ where: { tenantId: ctx.fixture.tenantB.id, action: 'software_update.checked' } })).toBe(0);
  });

  it('phân quyền: chưa đăng nhập 401; vai trò không có software_update.read 403 (cả xem lẫn kiểm tra)', async () => {
    expect((await request(ctx.app.getHttpServer()).get('/api/v1/system/update/status')).status).toBe(401);
    expect((await request(ctx.app.getHttpServer()).post('/api/v1/system/update/check')).status).toBe(401);
    for (const role of ['doctor', 'receptionist']) {
      const token = await ctx.tokenFor(ctx.fixture.tenantA.id, role);
      expect((await get(token)).status, role).toBe(403);
      expect((await check(token)).status, role).toBe(403);
    }
  });
});

describe('HTTP e2e — Cập nhật phần mềm (chưa cấu hình / cấu hình sai máy chủ phát hành)', () => {
  it('chưa cấu hình (biến trống): not_configured, "Kiểm tra ngay" không hỏi ai và không ghi nhật ký', async () => {
    const ctx = await bootstrap({ APP_VERSION: '0.9.0', DEPLOYMENT_MODE: 'single', RELEASE_SERVER_URL: '' }, 'Software update unconfigured e2e');
    try {
      const token = await ctx.tokenFor(ctx.fixture.tenantA.id, 'clinic_admin');
      const auth = { Authorization: `Bearer ${token}` };
      const status = await request(ctx.app.getHttpServer()).get('/api/v1/system/update/status').set(auth);
      expect(status.body.data).toMatchObject({ state: 'not_configured', configured: false, releaseServerUrl: null });
      const res = await request(ctx.app.getHttpServer()).post('/api/v1/system/update/check').set(auth);
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe('not_configured');
      expect(await ctx.privileged.auditLog.count({ where: { tenantId: ctx.fixture.tenantA.id, action: 'software_update.checked' } })).toBe(0);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it('địa chỉ http không phải localhost bị từ chối (bắt buộc HTTPS)', async () => {
    const ctx = await bootstrap({ APP_VERSION: '0.9.0', DEPLOYMENT_MODE: 'single', RELEASE_SERVER_URL: 'http://release.example.com' }, 'Software update http e2e');
    try {
      const token = await ctx.tokenFor(ctx.fixture.tenantA.id, 'clinic_admin');
      const res = await request(ctx.app.getHttpServer()).post('/api/v1/system/update/check').set({ Authorization: `Bearer ${token}` });
      expect(res.body.data.state).toBe('error');
      expect(res.body.data.errorMessage).toContain('HTTPS');
    } finally {
      await ctx.close();
    }
  }, 60_000);
});

describe('HTTP e2e — Cập nhật phần mềm (chế độ SaaS)', () => {
  it('mọi đường dẫn trả 404, kể cả với quản trị viên và khi chưa đăng nhập', async () => {
    const ctx = await bootstrap({ APP_VERSION: '0.9.0', DEPLOYMENT_MODE: 'saas', RELEASE_SERVER_URL: 'http://127.0.0.1:9' }, 'Software update saas e2e');
    try {
      const token = await ctx.tokenFor(ctx.fixture.tenantA.id, 'clinic_admin');
      const auth = { Authorization: `Bearer ${token}` };
      const http = () => request(ctx.app.getHttpServer());
      expect((await http().get('/api/v1/system/update/status').set(auth)).status).toBe(404);
      expect((await http().post('/api/v1/system/update/check').set(auth)).status).toBe(404);
      expect((await http().get('/api/v1/system/update/status')).status).toBe(404);
      // Phiên bản vẫn công khai ở chế độ SaaS (hộp "Giới thiệu").
      expect((await http().get('/api/v1/system/version')).status).toBe(200);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
