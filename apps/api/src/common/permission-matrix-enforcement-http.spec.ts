import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../app.module';
import { ResponseInterceptor } from './response.interceptor';
import { DomainExceptionFilter } from './domain-exception.filter';
import { PERMISSION_METADATA_KEY, type PermissionMetadata } from './require-permission.decorator';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../testing/tenant-fixture';
import { seedPermissionCatalog } from '../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../infrastructure/persistence/seed-tenant-roles';

/**
 * Kiểm tra TOÀN BỘ hệ thống phân quyền từ bảng phân quyền (ma trận `role_permission`, chỉnh qua
 * `PUT /roles/:id/permissions` — đúng đường màn hình "Vai trò & Phân quyền" gọi) có được áp ĐÚNG ở MỌI
 * route hay không. Quét tự động mọi controller đã đăng ký (không liệt kê tay, route mới tự vào phạm vi):
 *
 *  0. Không có token → 401 ở mọi route (trừ danh sách route công khai có chủ đích bên dưới).
 *  1. Vai trò mới (ma trận toàn "none") → mọi route có `@RequirePermission` đều 403 `PERMISSION_DENIED`
 *     (bắt cả trường hợp quên gắn `PermissionGuard` vào controller — decorator có nhưng không ai đọc).
 *  2. Cấp ĐÚNG MỘT quyền (xoay vòng global/personal/department) → mọi route cần quyền đó KHÔNG còn bị
 *     `PERMISSION_DENIED`, còn route của quyền KHÁC vẫn bị chặn (không cấp lan).
 *  3. Thu hồi quyền đó về "none" → route lại bị chặn ngay (không cache).
 *  4. Mọi (module, action) mà route đòi đều có trong danh mục `permission` (không route "mồ côi" mà không
 *     vai trò nào cấp được); route đăng nhập-là-đủ (không khai quyền) nằm trong danh sách cho phép tường minh —
 *     endpoint MỚI quên khai quyền sẽ làm test này fail thay vì lặng lẽ mở cho mọi tài khoản.
 */

interface RouteInfo {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  label: string;
  permission?: PermissionMetadata;
}

const METHOD_NAME: Partial<Record<number, RouteInfo['method']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

/** Route CÔNG KHAI có chủ đích (không cần đăng nhập). */
const PUBLIC_ROUTES = new Set<string>([
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
  'GET /api/v1/health',
  'GET /health',
  // Tải file theo chữ ký URL có hạn (ảnh đại diện/logo/chữ ký) — xác thực bằng token ký trong URL, không bằng JWT;
  // token sai/hết hạn → 403 (xem signed-url.ts), không phải 401.
  'GET /api/v1/files/:token',
]);

/**
 * Route yêu cầu ĐĂNG NHẬP nhưng cố ý KHÔNG đòi quyền riêng — tự-phục vụ theo tài khoản/hiển thị tuỳ chọn tối
 * thiểu (xem docs/DECISIONS.md #030/#064/#095/#096...). Thêm endpoint mới KHÔNG khai quyền mà không có trong
 * danh sách này → test fail: phải khai `@RequirePermission` hoặc thêm vào đây kèm lý do.
 */
const LOGIN_ONLY_ROUTES = new Set<string>([
  'GET /api/v1/auth/me',
  'POST /api/v1/auth/change-password',
  'POST /api/v1/break-glass',
  'GET /api/v1/users/me',
  'PATCH /api/v1/users/me',
  // Cấu hình tối thiểu tự-phục vụ (mọi nhân viên cần đọc để UI hoạt động đúng, không lộ dữ liệu nghiệp vụ).
  'GET /api/v1/clinic-settings/deferred-payment-enabled',
  'GET /api/v1/clinic-settings/allow-staff-self-schedule-enabled',
  'GET /api/v1/clinic-settings/cashier-shift-required-enabled',
  'GET /api/v1/clinic-settings/wallet-mixed-payment-enabled',
  // Bản mẫu in MẶC ĐỊNH của từng chứng từ (#211) — mọi nhân viên cần để in; chỉ chứa cấu hình bố cục, không dữ liệu nhạy cảm.
  'GET /api/v1/print-templates/resolved',
  'GET /api/v1/clinic-settings/sidebar-auto-collapse-enabled',
  'GET /api/v1/clinic-settings/solo-clinic-workflow-enabled',
  'GET /api/v1/clinic-settings/pharmacy-stock-tracking-enabled',
  'GET /api/v1/clinic-settings/allow-free-text-prescription-enabled',
  'GET /api/v1/clinic-settings/icd10-suggestion-enabled',
  'GET /api/v1/clinic-settings/cashier-shift-blind-close-enabled',
  'GET /api/v1/clinic-profile/print-header',
  // Chiếu tối thiểu phục vụ màn đăng ký ca/điều phối của MỌI nhân viên (giờ làm việc chung, trạng thái khoá tháng, chính sách đóng ca).
  'GET /api/v1/work-shift-assignments/month-lock-status',
  'GET /api/v1/work-shift-assignments/business-hours',
  'GET /api/v1/doctor-availability/policy',
  // Phòng làm việc hôm nay của chính bác sĩ.
  'GET /api/v1/rooms/options',
  'GET /api/v1/rooms/my-session',
  'PUT /api/v1/rooms/my-session',
]);

/** Thay `:param` bằng UUID ngẫu nhiên — route chỉ cần đi qua guard; validate/404 phía sau không quan tâm. */
function fillPath(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, () => randomUUID());
}

function normalizePath(prefix: string, controllerPath: string, methodPath: string): string {
  const parts = [prefix, controllerPath, methodPath].map((p) => p.replace(/^\/+|\/+$/g, '')).filter((p) => p !== '');
  return '/' + parts.join('/');
}

describe('HTTP e2e — ma trận phân quyền áp đúng ở MỌI route', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Matrix@12345';

  let adminToken: string;
  let probeToken: string;
  let probeRoleId: string;
  let probeRoleVersion: number;
  const routes: RouteInfo[] = [];

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createUser(tenantId: string, roleId: string, label: string) {
    const username = `e2e-matrix-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(login.status).toBe(200);
    return login.body.data.accessToken as string;
  }

  function send(route: RouteInfo, token?: string) {
    const url = fillPath(route.path);
    const base = request(app.getHttpServer())[route.method](url);
    const withAuth = token ? base.set(authed(token)) : base;
    return route.method === 'get' || route.method === 'delete' ? withAuth : withAuth.send({});
  }

  /** Ghi ma trận của vai trò thăm dò qua đúng API màn hình dùng; tự theo dõi `version` (mỗi lần lưu tăng 1). */
  async function putProbeMatrix(entries: { permissionId: string; dataScope: 'none' | 'personal' | 'department' | 'global' }[]) {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/roles/${probeRoleId}/permissions`)
      .set(authed(adminToken))
      .send({ version: probeRoleVersion, entries });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    probeRoleVersion = res.body.data.role.version;
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

    fixture = await createTwoTenantFixture(privileged, 'Matrix e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);

    const adminRole = await privileged.role.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, name: 'clinic_admin' } });
    adminToken = await createUser(fixture.tenantA.id, adminRole.id, 'admin');

    // Vai trò thăm dò: tạo qua API, ma trận ban đầu toàn "none".
    const created = await request(app.getHttpServer()).post('/api/v1/roles').set(authed(adminToken)).send({ name: `Thăm dò ${randomUUID().slice(0, 8)}` });
    expect(created.status).toBe(200);
    probeRoleId = created.body.data.id;
    probeRoleVersion = created.body.data.version;
    probeToken = await createUser(fixture.tenantA.id, probeRoleId, 'probe');

    // Quét mọi controller đã đăng ký.
    const container = app.get(ModulesContainer);
    for (const mod of container.values()) {
      for (const wrapper of mod.controllers.values()) {
        const cls = wrapper.metatype as (new (...args: never[]) => unknown) | null;
        if (!cls) continue;
        const controllerPath = (Reflect.getMetadata(PATH_METADATA, cls) as string | string[] | undefined) ?? '';
        const prefix = 'api/v1';
        for (const name of Object.getOwnPropertyNames(cls.prototype)) {
          if (name === 'constructor') continue;
          const handler = (cls.prototype as Record<string, unknown>)[name];
          if (typeof handler !== 'function') continue;
          const methodCode = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
          if (methodCode === undefined) continue;
          const method = METHOD_NAME[methodCode];
          if (!method) continue;
          const methodPath = (Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined) ?? '';
          const path = normalizePath(prefix, Array.isArray(controllerPath) ? controllerPath[0]! : controllerPath, Array.isArray(methodPath) ? methodPath[0]! : methodPath);
          routes.push({
            method,
            path,
            label: `${method.toUpperCase()} ${path}`,
            permission: Reflect.getMetadata(PERMISSION_METADATA_KEY, handler) as PermissionMetadata | undefined,
          });
        }
      }
    }
  }, 120_000);

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('quét được số route đủ lớn (guard bắt buộc: không quét trượt làm test "xanh giả")', () => {
    const withPermission = routes.filter((r) => r.permission);
    expect(routes.length).toBeGreaterThan(200);
    expect(withPermission.length).toBeGreaterThan(180);
  });

  it('0. không có token → 401 ở mọi route (trừ route công khai có chủ đích)', async () => {
    const offenders: string[] = [];
    for (const route of routes) {
      if (PUBLIC_ROUTES.has(route.label)) continue;
      const res = await send(route);
      if (res.status !== 401) offenders.push(`${route.label} → ${res.status}`);
    }
    expect(offenders, `Route lộ cho người chưa đăng nhập:\n${offenders.join('\n')}`).toEqual([]);
  }, 300_000);

  it('4a. mọi (module, action) mà route đòi đều có trong danh mục permission', async () => {
    const catalog = await privileged.permission.findMany({ select: { module: true, action: true } });
    const known = new Set(catalog.map((p) => `${p.module}.${p.action}`));
    const missing = [...new Set(routes.filter((r) => r.permission).map((r) => `${r.permission!.module}.${r.permission!.action}`))].filter((k) => !known.has(k));
    expect(missing, `Route đòi quyền không có trong danh mục (không vai trò nào cấp được): ${missing.join(', ')}`).toEqual([]);
  });

  it('4b. route đăng-nhập-là-đủ (không khai quyền) phải nằm trong danh sách cho phép tường minh', () => {
    const unexpected = routes
      .filter((r) => !r.permission && !PUBLIC_ROUTES.has(r.label) && !LOGIN_ONLY_ROUTES.has(r.label))
      .map((r) => r.label);
    expect(unexpected, `Route KHÔNG khai @RequirePermission và không có trong LOGIN_ONLY_ROUTES — khai quyền hoặc thêm vào danh sách kèm lý do:\n${unexpected.join('\n')}`).toEqual([]);
  });

  it('1. vai trò mới (ma trận toàn "none") → MỌI route có khai quyền đều 403 PERMISSION_DENIED', async () => {
    const offenders: string[] = [];
    for (const route of routes.filter((r) => r.permission)) {
      const res = await send(route, probeToken);
      if (res.status !== 403 || res.body?.error?.code !== 'PERMISSION_DENIED') {
        offenders.push(`${route.label} [${route.permission!.module}.${route.permission!.action}] → ${res.status} ${res.body?.error?.code ?? ''}`);
      }
    }
    expect(offenders, `Route KHÔNG chặn tài khoản không có quyền nào:\n${offenders.join('\n')}`).toEqual([]);
  }, 300_000);

  it('2+3. cấp ĐÚNG MỘT quyền (global/personal/department xoay vòng) → route của quyền đó mở, quyền khác vẫn chặn, thu hồi → chặn lại', async () => {
    const catalog = await privileged.permission.findMany({ select: { id: true, module: true, action: true } });
    const idByKey = new Map(catalog.map((p) => [`${p.module}.${p.action}`, p.id]));

    const byPermission = new Map<string, RouteInfo[]>();
    for (const route of routes.filter((r) => r.permission)) {
      const key = `${route.permission!.module}.${route.permission!.action}`;
      byPermission.set(key, [...(byPermission.get(key) ?? []), route]);
    }
    const keys = [...byPermission.keys()].filter((k) => idByKey.has(k)).sort();
    expect(keys.length).toBeGreaterThan(60);

    const scopes = ['global', 'personal', 'department'] as const;
    const failures: string[] = [];
    let previousId: string | undefined;

    for (const [index, key] of keys.entries()) {
      const permissionId = idByKey.get(key)!;
      const scope = scopes[index % scopes.length]!;
      await putProbeMatrix([...(previousId ? [{ permissionId: previousId, dataScope: 'none' as const }] : []), { permissionId, dataScope: scope }]);
      previousId = permissionId;

      // (a) route của đúng quyền này không còn bị PERMISSION_DENIED.
      for (const route of byPermission.get(key)!) {
        const res = await send(route, probeToken);
        if (res.status === 401 || res.body?.error?.code === 'PERMISSION_DENIED') {
          failures.push(`CẤP ${key}=${scope} nhưng ${route.label} vẫn → ${res.status} ${res.body?.error?.code ?? ''}`);
        }
      }

      // (b) quyền khác không bị cấp lan: kiểm 2 route của quyền khác (xoay vòng).
      const others = keys.filter((k) => k !== key);
      for (const offset of [1, Math.floor(others.length / 2)]) {
        const otherKey = others[(index + offset) % others.length]!;
        const otherRoute = byPermission.get(otherKey)![0]!;
        const res = await send(otherRoute, probeToken);
        if (res.status !== 403 || res.body?.error?.code !== 'PERMISSION_DENIED') {
          failures.push(`CHỈ cấp ${key} nhưng ${otherRoute.label} [${otherKey}] → ${res.status} ${res.body?.error?.code ?? ''} (cấp lan)`);
        }
      }
    }

    // (c) thu hồi quyền cuối cùng → chặn lại ngay; và thu hồi từng quyền trước khi sang quyền kế đã được kiểm ở (b) vòng sau.
    if (previousId) {
      await putProbeMatrix([{ permissionId: previousId, dataScope: 'none' }]);
      const lastKey = keys[keys.length - 1]!;
      for (const route of byPermission.get(lastKey)!) {
        const res = await send(route, probeToken);
        if (res.status !== 403 || res.body?.error?.code !== 'PERMISSION_DENIED') {
          failures.push(`THU HỒI ${lastKey} nhưng ${route.label} → ${res.status} ${res.body?.error?.code ?? ''}`);
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  }, 900_000);

  it('thu hồi từng quyền về "none" qua ma trận → chặn lại NGAY ở mọi route của quyền đó (không cache)', async () => {
    const catalog = await privileged.permission.findMany({ select: { id: true, module: true, action: true } });
    const idByKey = new Map(catalog.map((p) => [`${p.module}.${p.action}`, p.id]));
    const byPermission = new Map<string, RouteInfo[]>();
    for (const route of routes.filter((r) => r.permission)) {
      const key = `${route.permission!.module}.${route.permission!.action}`;
      byPermission.set(key, [...(byPermission.get(key) ?? []), route]);
    }
    const failures: string[] = [];
    for (const [key, list] of [...byPermission.entries()].filter(([k]) => idByKey.has(k)).slice(0, 40)) {
      const permissionId = idByKey.get(key)!;
      await putProbeMatrix([{ permissionId, dataScope: 'global' }]);
      const opened = await send(list[0]!, probeToken);
      if (opened.body?.error?.code === 'PERMISSION_DENIED') failures.push(`CẤP ${key} nhưng ${list[0]!.label} vẫn bị chặn`);
      await putProbeMatrix([{ permissionId, dataScope: 'none' }]);
      for (const route of list) {
        const res = await send(route, probeToken);
        if (res.status !== 403 || res.body?.error?.code !== 'PERMISSION_DENIED') failures.push(`THU HỒI ${key} nhưng ${route.label} → ${res.status}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  }, 600_000);
});
