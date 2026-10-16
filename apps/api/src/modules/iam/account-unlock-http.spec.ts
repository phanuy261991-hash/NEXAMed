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

/**
 * HTTP e2e cho khoá đăng nhập luỹ tiến → vĩnh viễn và "Mở khoá" (docs/DECISIONS.md #239): thông báo số phút khoá, khoá vĩnh viễn chặn cả mật khẩu đúng,
 * quyền riêng `user_account.unlock`, phạm vi theo CHI NHÁNH (chỉ mở được tài khoản chung ít nhất một chi nhánh), cô lập tenant, optimistic locking.
 * Số lần gọi /auth/login giữ ≤ 10/phút (rate limit theo IP) — các trạng thái khoá dựng qua Prisma đặc quyền, chuỗi sai-liên-tiếp kiểm ở `auth.spec.ts`.
 */
describe('HTTP e2e — khoá đăng nhập & mở khoá tài khoản (/api/v1/users/:id/unlock)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchA: string;
  let branchB: string;
  let adminAllToken: string; // clinic_admin gán cả hai chi nhánh
  let adminAOnlyToken: string; // clinic_admin gán riêng chi nhánh A
  let receptionistToken: string; // không có user_account.unlock
  let tenantBAdminToken: string;
  const staffA = { id: '', username: '' };
  const staffB = { id: '', username: '' };

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(tenantId: string, roleName: string, label: string) {
    const username = `e2e-unlock-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return { id: user.id, username };
  }

  async function assign(userId: string, ...branchIds: string[]) {
    for (const branchId of branchIds) {
      await privileged.userBranch.create({ data: { tenantId: fixture.tenantA.id, userId, branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
  }

  async function loginToken(tenantId: string, username: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.accessToken as string;
  }

  const currentVersion = async (id: string) => (await privileged.userAccount.findUniqueOrThrow({ where: { id } })).version;
  const clearLocks = (id: string) =>
    privileged.userAccount.update({ where: { id }, data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, lockoutLevel: 0, lockedPermanentlyAt: null } });

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

    fixture = await createTwoTenantFixture(privileged, 'Unlock e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    // Quản trị gán cả hai chi nhánh: tạo chi nhánh thứ hai qua API (đúng đường đi thật) NGAY khi chỉ mới có quản trị — lúc đó hệ thống tự gán
    // chi nhánh mặc định cho người đã có sẵn; các tài khoản còn lại tạo SAU và gán tường minh.
    const adminAll = await createUser(fixture.tenantA.id, 'clinic_admin', 'adminall');
    adminAllToken = await loginToken(fixture.tenantA.id, adminAll.username);
    const created = await http().post('/api/v1/branches').set(authed(adminAllToken)).send({ name: 'Chi nhánh Quận 7', address: '88 Nguyễn Thị Thập', phone: '0283777556' });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    branchB = created.body.data.id;
    await assign(adminAll.id, branchB);
    const adminAllRows = await privileged.userBranch.findMany({ where: { tenantId: fixture.tenantA.id, userId: adminAll.id, deletedAt: null } });
    expect(adminAllRows.map((r) => r.branchId).sort()).toEqual([branchA, branchB].sort());

    const adminAOnly = await createUser(fixture.tenantA.id, 'clinic_admin', 'admina');
    const receptionist = await createUser(fixture.tenantA.id, 'receptionist', 'recep');
    const tenantBAdmin = await createUser(fixture.tenantB.id, 'clinic_admin', 'adminb');
    const sa = await createUser(fixture.tenantA.id, 'doctor', 'staffa');
    const sb = await createUser(fixture.tenantA.id, 'doctor', 'staffb');
    Object.assign(staffA, sa);
    Object.assign(staffB, sb);
    await assign(adminAOnly.id, branchA);
    await assign(receptionist.id, branchA);
    await assign(staffA.id, branchA);
    await assign(staffB.id, branchB);

    adminAOnlyToken = await loginToken(fixture.tenantA.id, adminAOnly.username);
    receptionistToken = await loginToken(fixture.tenantA.id, receptionist.username);
    tenantBAdminToken = await loginToken(fixture.tenantB.id, tenantBAdmin.username);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('khoá tạm: đăng nhập báo CỤ THỂ số phút khoá (message + details), kể cả khi nhập đúng mật khẩu', async () => {
    await privileged.userAccount.update({ where: { id: staffA.id }, data: { lockedUntil: new Date(Date.now() + 5 * 60_000 - 5_000), lockoutLevel: 1 } });
    const res = await http().post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username: staffA.username, password });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('AUTH_ACCOUNT_LOCKED');
    expect(res.body.error.message).toContain('5 phút');
    expect(res.body.error.details.retryAfterMinutes).toBe(5);
    expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(290);
    expect(res.body.error.details.retryAfterSeconds).toBeLessThanOrEqual(300);
    await clearLocks(staffA.id);
  });

  it('khoá vĩnh viễn: chặn cả mật khẩu đúng, báo phải liên hệ quản trị, danh sách tài khoản hiện PERMANENT', async () => {
    await privileged.userAccount.update({ where: { id: staffA.id }, data: { lockedPermanentlyAt: new Date(), lockoutLevel: 3 } });
    const res = await http().post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username: staffA.username, password });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('AUTH_ACCOUNT_LOCKED_PERMANENT');
    expect(res.body.error.message).toContain('quản trị viên');

    const list = await http().get('/api/v1/users?limit=100').set(authed(adminAllToken));
    expect(list.status).toBe(200);
    const row = list.body.data.items.find((u: { id: string }) => u.id === staffA.id);
    expect(row).toMatchObject({ lockStatus: 'PERMANENT', lockedUntil: null });
  });

  it('thiếu quyền user_account.unlock (lễ tân) → 403; chưa đăng nhập → 401', async () => {
    const version = await currentVersion(staffA.id);
    expect((await http().post(`/api/v1/users/${staffA.id}/unlock`).send({ version })).status).toBe(401);
    const denied = await http().post(`/api/v1/users/${staffA.id}/unlock`).set(authed(receptionistToken)).send({ version });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PERMISSION_DENIED');
    expect((await privileged.userAccount.findUniqueOrThrow({ where: { id: staffA.id } })).lockedPermanentlyAt).not.toBeNull();
  });

  it('phạm vi chi nhánh: quản trị chỉ ở chi nhánh A không mở được tài khoản chỉ ở chi nhánh B (404), mở được tài khoản chi nhánh A', async () => {
    await privileged.userAccount.update({ where: { id: staffB.id }, data: { lockedPermanentlyAt: new Date(), lockoutLevel: 3 } });

    const other = await http().post(`/api/v1/users/${staffB.id}/unlock`).set(authed(adminAOnlyToken)).send({ version: await currentVersion(staffB.id) });
    expect(other.status).toBe(404);
    expect((await privileged.userAccount.findUniqueOrThrow({ where: { id: staffB.id } })).lockedPermanentlyAt).not.toBeNull();

    const ok = await http().post(`/api/v1/users/${staffA.id}/unlock`).set(authed(adminAOnlyToken)).send({ version: await currentVersion(staffA.id) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ id: staffA.id, lockStatus: 'NONE', lockedUntil: null });
    const after = await privileged.userAccount.findUniqueOrThrow({ where: { id: staffA.id } });
    expect(after).toMatchObject({ lockedPermanentlyAt: null, lockoutLevel: 0, failedLoginCount: 0, lockedUntil: null });

    // Mở khoá không đổi mật khẩu: đăng nhập lại bằng mật khẩu cũ được ngay.
    const relogin = await http().post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username: staffA.username, password });
    expect(relogin.status, JSON.stringify(relogin.body)).toBe(200);

    const audit = await privileged.auditLog.findMany({ where: { tenantId: fixture.tenantA.id, action: 'user_account.unlocked', entityId: staffA.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.beforeJson).toMatchObject({ lockStatus: 'PERMANENT' });
  });

  it('quản trị gán cả hai chi nhánh mở được tài khoản chi nhánh B (cả khoá tạm lẫn vĩnh viễn)', async () => {
    const ok = await http().post(`/api/v1/users/${staffB.id}/unlock`).set(authed(adminAllToken)).send({ version: await currentVersion(staffB.id) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.lockStatus).toBe('NONE');

    await privileged.userAccount.update({ where: { id: staffB.id }, data: { lockedUntil: new Date(Date.now() + 15 * 60_000), lockoutLevel: 2 } });
    const list = await http().get('/api/v1/users?limit=100').set(authed(adminAllToken));
    expect(list.body.data.items.find((u: { id: string }) => u.id === staffB.id)).toMatchObject({ lockStatus: 'TEMPORARY' });
    const temp = await http().post(`/api/v1/users/${staffB.id}/unlock`).set(authed(adminAllToken)).send({ version: await currentVersion(staffB.id) });
    expect(temp.status).toBe(200);
    expect(temp.body.data.lockStatus).toBe('NONE');
  });

  it('version cũ → 409 CONCURRENT_MODIFICATION, tài khoản vẫn khoá', async () => {
    await privileged.userAccount.update({ where: { id: staffA.id }, data: { lockedPermanentlyAt: new Date(), lockoutLevel: 3 } });
    const stale = (await currentVersion(staffA.id)) - 1;
    const res = await http().post(`/api/v1/users/${staffA.id}/unlock`).set(authed(adminAllToken)).send({ version: stale });
    expect(res.status).toBe(409);
    expect((await privileged.userAccount.findUniqueOrThrow({ where: { id: staffA.id } })).lockedPermanentlyAt).not.toBeNull();
    await clearLocks(staffA.id);
  });

  it('tài khoản không bị khoá: mở khoá là no-op, không ghi nhật ký "mở khoá" giả', async () => {
    const before = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'user_account.unlocked', entityId: staffA.id } });
    const res = await http().post(`/api/v1/users/${staffA.id}/unlock`).set(authed(adminAllToken)).send({ version: await currentVersion(staffA.id) });
    expect(res.status).toBe(200);
    expect(res.body.data.lockStatus).toBe('NONE');
    expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'user_account.unlocked', entityId: staffA.id } })).toBe(before);
  });

  it('cô lập tenant: quản trị công ty khác mở khoá tài khoản này → 404, tài khoản vẫn khoá', async () => {
    await privileged.userAccount.update({ where: { id: staffA.id }, data: { lockedPermanentlyAt: new Date(), lockoutLevel: 3 } });
    const res = await http().post(`/api/v1/users/${staffA.id}/unlock`).set(authed(tenantBAdminToken)).send({ version: await currentVersion(staffA.id) });
    expect(res.status).toBe(404);
    expect((await privileged.userAccount.findUniqueOrThrow({ where: { id: staffA.id } })).lockedPermanentlyAt).not.toBeNull();
  });

  it('đặt lại mật khẩu cũng gỡ khoá vĩnh viễn (lối thoát khi không còn quản trị nào mở được)', async () => {
    const res = await http()
      .post(`/api/v1/users/${staffA.id}/reset-password`)
      .set(authed(adminAllToken))
      .send({ newPassword: 'MatKhauMoi@2026', version: await currentVersion(staffA.id) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.lockStatus).toBe('NONE');
    expect(await privileged.userAccount.findUniqueOrThrow({ where: { id: staffA.id } })).toMatchObject({ lockedPermanentlyAt: null, lockoutLevel: 0 });
  });
});
