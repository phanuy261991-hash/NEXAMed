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
 * HTTP e2e cho tầng CHI NHÁNH, Đợt 1 (docs/DECISIONS.md #231): quản lý chi nhánh, đăng nhập/đổi chi nhánh làm việc, gán chi nhánh cho tài khoản,
 * cô lập dữ liệu theo chi nhánh (phòng, lịch hẹn, lượt khám) và xem lịch sử khám liên chi nhánh (đi theo người bệnh; tiền là của chi nhánh).
 * Số lần đăng nhập giữ ≤ 10/phút (rate limit /auth/login) — mọi dữ liệu chi nhánh B dựng qua Prisma đặc quyền, đọc/ghi qua HTTP.
 */
describe('HTTP e2e — Chi nhánh (/api/v1/branches, /auth/switch-branch, cô lập theo chi nhánh)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let branchA: string;
  let branchB: string;
  let branchC: string;
  let adminToken: string;
  let receptionistToken: string;
  let tenantBAdminToken: string;
  let multiUserId: string;
  let multiUsername: string;
  let multiToken: string;
  let multiCookie: string;
  let onlyBToken: string;

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(tenantId: string, roleName: string, label: string) {
    const username = `e2e-br-${label}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId, username, passwordHash, fullName: `User ${label}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return { id: user.id, username };
  }

  async function login(tenantId: string, username: string) {
    const res = await http().post('/api/v1/auth/login').send({ tenantId, username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    return { token: res.body.data.accessToken as string, user: res.body.data.user, cookie };
  }

  async function assign(userId: string, ...branchIds: string[]) {
    for (const branchId of branchIds) {
      await privileged.userBranch.create({ data: { tenantId: fixture.tenantA.id, userId, branchId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    }
  }

  async function createPatient(): Promise<string> {
    const n = Math.floor(Math.random() * 1_000_000_000);
    const patient = await privileged.patient.create({
      data: {
        tenantId: fixture.tenantA.id,
        patientCode: `BN-BR-${n}`,
        fullName: `Bệnh nhân chi nhánh ${n}`,
        dob: new Date('1990-01-01'),
        gender: 'other',
        phone: `09${String(n).padStart(8, '0').slice(-8)}`,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    return patient.id;
  }

  async function createEncounter(patientId: string, branchId: string, status: 'CHECKED_IN' | 'COMPLETED', doctorId?: string) {
    const department = await privileged.department.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, isDefault: true } });
    return privileged.encounter.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId,
        patientId,
        doctorId: doctorId ?? null,
        departmentId: department.id,
        encounterNo: `LK-BR-${Math.floor(Math.random() * 1_000_000_000)}`,
        status,
        checkedInAt: new Date(),
        completedAt: status === 'COMPLETED' ? new Date() : null,
        insuranceSnapshot: { selfPay: true },
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
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

    fixture = await createTwoTenantFixture(privileged, 'Branch e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    branchA = await getDefaultBranchId(privileged, fixture.tenantA.id);

    const admin = await createUser(fixture.tenantA.id, 'clinic_admin', 'admin');
    const receptionist = await createUser(fixture.tenantA.id, 'receptionist', 'recep');
    const tenantBAdmin = await createUser(fixture.tenantB.id, 'clinic_admin', 'adminB');
    adminToken = (await login(fixture.tenantA.id, admin.username)).token;
    receptionistToken = (await login(fixture.tenantA.id, receptionist.username)).token;
    tenantBAdminToken = (await login(fixture.tenantB.id, tenantBAdmin.username)).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('công ty 1 chi nhánh: đăng nhập trả đúng 1 chi nhánh + tự chọn, /auth/me khớp (giao diện không thấy gì khác)', async () => {
    const me = await http().get('/api/v1/auth/me').set(authed(adminToken));
    expect(me.status).toBe(200);
    expect(me.body.data.branches).toHaveLength(1);
    expect(me.body.data.branches[0]).toMatchObject({ id: branchA, code: 'CN00001', isDefault: true });
    expect(me.body.data.currentBranchId).toBe(branchA);
    expect(me.body.data.multiBranchCompany).toBe(false);
  });

  it('GET /branches: chưa đăng nhập → 401; vai trò không có branch.read (lễ tân) → 403; clinic_admin xem được', async () => {
    expect((await http().get('/api/v1/branches')).status).toBe(401);
    const denied = await http().get('/api/v1/branches').set(authed(receptionistToken));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PERMISSION_DENIED');
    const ok = await http().get('/api/v1/branches').set(authed(adminToken));
    expect(ok.status).toBe(200);
    expect(ok.body.data.items).toHaveLength(1);
    // Công ty 1 chi nhánh: mọi tài khoản đang hoạt động đều thuộc chi nhánh đó.
    expect(ok.body.data.items[0].staffCount).toBeGreaterThanOrEqual(2);
  });

  it('thêm chi nhánh: mã CN tự sinh theo tenant, trùng tên → 409, tài khoản chưa có dòng gán được giữ ở chi nhánh mặc định', async () => {
    const created = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'Chi nhánh Quận 7', address: '88 Nguyễn Thị Thập', phone: '0283777556' });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.data).toMatchObject({ code: 'CN00002', name: 'Chi nhánh Quận 7', isDefault: false, isActive: true });
    branchB = created.body.data.id;

    const dup = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'chi nhánh quận 7' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('BRANCH_DUPLICATE_NAME');

    const third = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'Chi nhánh Thủ Đức' });
    expect(third.status).toBe(200);
    branchC = third.body.data.id;

    // Các tài khoản dựng trực tiếp ở DB (chưa có `user_branch`) vẫn vào được chi nhánh mặc định sau khi công ty có ≥ 2 chi nhánh.
    const rows = await privileged.userBranch.count({ where: { tenantId: fixture.tenantA.id, branchId: branchA, deletedAt: null } });
    expect(rows).toBeGreaterThanOrEqual(2);
  });

  it('tên chi nhánh quá 100 ký tự → 400 (tránh vỡ giao diện/đầu phiếu in); đúng 100 ký tự vẫn được', async () => {
    const tooLong = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'A'.repeat(101) });
    expect(tooLong.status).toBe(400);

    const exact = await http().post('/api/v1/branches').set(authed(adminToken)).send({ name: 'B'.repeat(100) });
    expect(exact.status, JSON.stringify(exact.body)).toBe(200);
    const tooLongEdit = await http()
      .patch(`/api/v1/branches/${exact.body.data.id}`)
      .set(authed(adminToken))
      .send({ name: 'C'.repeat(101), version: exact.body.data.version });
    expect(tooLongEdit.status).toBe(400);
    // Dọn: ngưng chi nhánh thử để không ảnh hưởng các test đếm chi nhánh phía sau.
    await http().patch(`/api/v1/branches/${exact.body.data.id}`).set(authed(adminToken)).send({ isActive: false, version: exact.body.data.version });
  });

  it('cô lập tenant: tenant B không thấy/không sửa được chi nhánh tenant A (404)', async () => {
    const list = await http().get('/api/v1/branches?includeInactive=true').set(authed(tenantBAdminToken));
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((b: { id: string }) => b.id === branchB)).toBe(false);
    const patch = await http().patch(`/api/v1/branches/${branchB}`).set(authed(tenantBAdminToken)).send({ name: 'Tenant B cố sửa', version: 1 });
    expect(patch.status).toBe(404);
  });

  it('chi nhánh mặc định không ngưng được (409); ngưng/khôi phục chi nhánh thường; version cũ → 409', async () => {
    const list = await http().get('/api/v1/branches').set(authed(adminToken));
    const def = list.body.data.items.find((b: { id: string }) => b.id === branchA);
    const denied = await http().patch(`/api/v1/branches/${branchA}`).set(authed(adminToken)).send({ isActive: false, version: def.version });
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe('BRANCH_DEFAULT_IMMUTABLE');

    const c = list.body.data.items.find((b: { id: string }) => b.id === branchC);
    const off = await http().patch(`/api/v1/branches/${branchC}`).set(authed(adminToken)).send({ isActive: false, version: c.version });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);
    const stale = await http().patch(`/api/v1/branches/${branchC}`).set(authed(adminToken)).send({ isActive: true, version: c.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONCURRENT_MODIFICATION');
    const on = await http().patch(`/api/v1/branches/${branchC}`).set(authed(adminToken)).send({ isActive: true, version: off.body.data.version });
    expect(on.status).toBe(200);
  });

  it('tài khoản được gán 2 chi nhánh: đăng nhập chưa chọn (currentBranchId=null) → dữ liệu theo địa điểm 409 BRANCH_NOT_SELECTED', async () => {
    const multi = await createUser(fixture.tenantA.id, 'doctor', 'multi');
    multiUserId = multi.id;
    multiUsername = multi.username;
    await assign(multiUserId, branchA, branchB);
    const session = await login(fixture.tenantA.id, multiUsername);
    expect(session.user.branches).toHaveLength(2);
    expect(session.user.currentBranchId).toBeNull();
    multiToken = session.token;
    multiCookie = session.cookie;

    const blocked = await http().get('/api/v1/rooms/options').set(authed(multiToken));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('BRANCH_NOT_SELECTED');
  });

  it('đổi chi nhánh: sang chi nhánh KHÔNG được gán → 403; thiếu cookie phiên → 401; sang chi nhánh được gán → token mới dùng được', async () => {
    const denied = await http().post('/api/v1/auth/switch-branch').set(authed(multiToken)).set('Cookie', multiCookie).send({ branchId: branchC });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('BRANCH_NOT_ASSIGNED');

    const noCookie = await http().post('/api/v1/auth/switch-branch').set(authed(multiToken)).send({ branchId: branchB });
    expect(noCookie.status).toBe(401);

    const ok = await http().post('/api/v1/auth/switch-branch').set(authed(multiToken)).set('Cookie', multiCookie).send({ branchId: branchB });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.currentBranchId).toBe(branchB);
    multiToken = ok.body.data.accessToken;
    const options = await http().get('/api/v1/rooms/options').set(authed(multiToken));
    expect(options.status).toBe(200);

    const audit = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'auth.branch_switched', actorId: multiUserId } });
    expect(audit).toBe(1);
  });

  it('"Nhớ lựa chọn": đăng nhập lại vào thẳng chi nhánh đã chọn; tài khoản chỉ gán 1 chi nhánh (công ty nhiều chi nhánh) tự vào chi nhánh đó', async () => {
    const again = await login(fixture.tenantA.id, multiUsername);
    expect(again.user.currentBranchId).toBe(branchB);

    const onlyB = await createUser(fixture.tenantA.id, 'doctor', 'onlyB');
    await assign(onlyB.id, branchB);
    const session = await login(fixture.tenantA.id, onlyB.username);
    expect(session.user.branches).toHaveLength(1);
    expect(session.user.currentBranchId).toBe(branchB);
    // Chỉ được gán 1 chi nhánh nhưng công ty có nhiều chi nhánh: cờ cấp công ty vẫn bật (để giao diện hiện phiếu đến từ chi nhánh khác).
    expect(session.user.multiBranchCompany).toBe(true);
    onlyBToken = session.token;
  });

  it('PHÒNG theo chi nhánh: phòng ở chi nhánh A không hiện ở chi nhánh B, không sửa được từ B (404)', async () => {
    const roomA = await http().post('/api/v1/rooms').set(authed(adminToken)).send({ name: 'Phòng Quận 1' });
    expect(roomA.status).toBe(200);
    const roomB = await privileged.room.create({ data: { tenantId: fixture.tenantA.id, branchId: branchB, name: 'Phòng Quận 7', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });

    const listA = await http().get('/api/v1/rooms').set(authed(adminToken));
    expect(listA.body.data.items.map((r: { name: string }) => r.name)).toContain('Phòng Quận 1');
    expect(listA.body.data.items.map((r: { name: string }) => r.name)).not.toContain('Phòng Quận 7');

    const optionsB = await http().get('/api/v1/rooms/options').set(authed(multiToken));
    expect(optionsB.body.data.items.map((r: { name: string }) => r.name)).toEqual(['Phòng Quận 7']);
    // Tài khoản chỉ được gán chi nhánh B cũng chỉ thấy phòng của B.
    const optionsOnlyB = await http().get('/api/v1/rooms/options').set(authed(onlyBToken));
    expect(optionsOnlyB.body.data.items.map((r: { name: string }) => r.name)).toEqual(['Phòng Quận 7']);

    const crossPatch = await http().patch(`/api/v1/rooms/${roomB.id}`).set(authed(adminToken)).send({ name: 'Sửa từ chi nhánh khác', version: roomB.version });
    expect(crossPatch.status).toBe(404);
  });

  it('LỊCH HẸN theo chi nhánh: lịch ở chi nhánh B không liệt kê/không tra theo id được từ chi nhánh A', async () => {
    const appointment = await privileged.appointment.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: branchB,
        doctorId: multiUserId,
        bookingCode: `LH-BR-${randomUUID().slice(0, 8)}`,
        fullName: 'Khách chi nhánh B',
        phone: '0900000001',
        scheduledAt: new Date(Date.now() + 3_600_000),
        durationMinutes: 15,
        source: 'phone',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const fromB = await http().get(`/api/v1/appointments/${appointment.id}`).set(authed(multiToken));
    expect(fromB.status).toBe(200);
    const fromA = await http().get(`/api/v1/appointments/${appointment.id}`).set(authed(adminToken));
    expect(fromA.status).toBe(404);
    const listA = await http().get('/api/v1/appointments').set(authed(adminToken));
    expect(listA.body.data.items.some((a: { id: string }) => a.id === appointment.id)).toBe(false);
  });

  it('LƯỢT KHÁM theo chi nhánh: đang diễn ra ở chi nhánh khác → 404; ĐÃ HOÀN TẤT thì xem được (lịch sử khám) kèm nhật ký xem liên chi nhánh', async () => {
    const patientId = await createPatient();
    const open = await createEncounter(patientId, branchB, 'CHECKED_IN', multiUserId);
    const done = await createEncounter(patientId, branchB, 'COMPLETED', multiUserId);

    const openFromA = await http().get(`/api/v1/encounters/${open.id}/consultation`).set(authed(adminToken));
    expect(openFromA.status).toBe(404);
    const doneFromA = await http().get(`/api/v1/encounters/${done.id}/consultation`).set(authed(adminToken));
    expect(doneFromA.status, JSON.stringify(doneFromA.body)).toBe(200);
    const audit = await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, action: 'encounter.history_viewed_cross_branch', entityId: done.id } });
    expect(audit).toBe(1);

    // Ghi/sửa lượt khám của chi nhánh khác: luôn 404 dù đã hoàn tất.
    const write = await http().post(`/api/v1/encounters/${done.id}/cancel`).set(authed(adminToken)).send({ version: done.version, cancelReason: 'Thử huỷ từ chi nhánh khác' });
    expect(write.status, JSON.stringify(write.body)).toBe(404);
  });

  it('LỊCH SỬ KHÁM liên chi nhánh: hiện đủ mọi chi nhánh kèm tên nơi khám; tiền của chi nhánh không được gán bị che', async () => {
    const patientId = await createPatient();
    await createEncounter(patientId, branchA, 'COMPLETED');
    await createEncounter(patientId, branchB, 'COMPLETED');

    // admin chỉ thuộc chi nhánh A (tài khoản dựng ở DB, được giữ ở chi nhánh mặc định khi công ty có thêm chi nhánh).
    const asAdmin = await http().get(`/api/v1/encounters/by-patient/${patientId}/history?status=ALL`).set(authed(adminToken));
    expect(asAdmin.status, JSON.stringify(asAdmin.body)).toBe(200);
    expect(asAdmin.body.data.multiBranch).toBe(true);
    expect(asAdmin.body.data.items).toHaveLength(2);
    const byBranch = Object.fromEntries(asAdmin.body.data.items.map((i: { branchName: string }) => [i.branchName, i]));
    expect(byBranch['Chi nhánh Quận 7']).toMatchObject({ isOtherBranch: true, billingHidden: true, billing: null });
    const own = asAdmin.body.data.items.find((i: { isOtherBranch: boolean }) => !i.isOtherBranch);
    expect(own).toMatchObject({ billingHidden: false });

    // Người được gán CẢ HAI chi nhánh thì thấy đủ, không che tiền.
    const asMulti = await http().get(`/api/v1/encounters/by-patient/${patientId}/history?status=ALL`).set(authed(multiToken));
    expect(asMulti.status).toBe(200);
    expect(asMulti.body.data.items.every((i: { billingHidden: boolean }) => i.billingHidden === false)).toBe(true);
  });

  it('TÀI KHOẢN: tạo mới mặc định vào chi nhánh đang làm; branchIds sai/khác công ty → 422; đổi chi nhánh buộc đăng nhập lại', async () => {
    const roleId = (await privileged.role.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, name: 'receptionist' } })).id;
    const base = { fullName: 'Nhân viên mới', displayName: 'NV mới', password: 'Passw0rd!x1', roleIds: [roleId] };

    const created = await http().post('/api/v1/users').set(authed(adminToken)).send({ ...base, username: `e2e-br-new-${randomUUID().slice(0, 8)}` });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.data.branchIds).toEqual([branchA]);

    const otherTenantBranch = await getDefaultBranchId(privileged, fixture.tenantB.id);
    const bad = await http().post('/api/v1/users').set(authed(adminToken)).send({ ...base, username: `e2e-br-bad-${randomUUID().slice(0, 8)}`, branchIds: [otherTenantBranch] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('BRANCH_INVALID_REFERENCE');

    const userId = created.body.data.id as string;
    await privileged.userSession.create({
      data: {
        tenantId: fixture.tenantA.id,
        userId,
        refreshTokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000),
        createdBy: userId,
        updatedBy: userId,
      },
    });
    const patched = await http().patch(`/api/v1/users/${userId}`).set(authed(adminToken)).send({ branchIds: [branchA, branchB], version: created.body.data.version });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect([...patched.body.data.branchIds].sort()).toEqual([branchA, branchB].sort());
    const active = await privileged.userSession.count({ where: { tenantId: fixture.tenantA.id, userId, deletedAt: null } });
    expect(active).toBe(0);
  });

  it('ĐƠN XIN NGHỈ theo chi nhánh: đơn ở chi nhánh B không hiện ở danh sách chi nhánh A', async () => {
    const leave = await privileged.leaveRequest.create({
      data: {
        tenantId: fixture.tenantA.id,
        branchId: branchB,
        userId: multiUserId,
        leaveDate: new Date(Date.now() + 86_400_000 * 3),
        startMinute: 0,
        endMinute: 1440,
        status: 'PENDING',
        reason: 'Việc riêng',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const listA = await http().get('/api/v1/leave-requests').set(authed(adminToken));
    expect(listA.status, JSON.stringify(listA.body)).toBe(200);
    expect(listA.body.data.items.some((i: { id: string }) => i.id === leave.id)).toBe(false);
    const approveFromA = await http().post(`/api/v1/leave-requests/${leave.id}/approve`).set(authed(adminToken)).send({ version: leave.version });
    expect(approveFromA.status).toBe(404);
  });
});
