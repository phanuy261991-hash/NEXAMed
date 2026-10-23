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
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * Khoá đăng nhập THÔNG MINH theo "máy quen" (docs/DECISIONS.md #259, sửa #239). Mỗi "trình duyệt" là một `supertest.agent` có kho cookie riêng:
 *  - CHÍNH CHỦ: đã đăng nhập đúng một lần → giữ cookie `nx_dev_<id>` (máy quen);
 *  - KẺ LẠ: agent mới, không cookie (máy lạ) — người cùng LAN gõ sai mật khẩu để tê liệt tài khoản.
 * Mỗi test dùng tài khoản RIÊNG (giới hạn tần suất đăng nhập tính theo tài khoản, 10/phút — #258).
 */
describe('HTTP e2e — khoá thông minh theo máy quen (#259)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';
  const WRONG = 'Sai@Mat-khau-1';

  async function createUser(roleName = 'receptionist') {
    const username = `e2e-smart-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: { tenantId: fixture.tenantA.id, username, passwordHash, fullName: 'User smart lock', createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, name: roleName } });
    await privileged.userRole.create({ data: { tenantId: fixture.tenantA.id, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    return { id: user.id as string, username };
  }

  const browser = () => request.agent(app.getHttpServer());
  const login = (agent: ReturnType<typeof browser>, username: string, pw: string = password) =>
    agent.post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username, password: pw });
  const rowOf = (id: string) => privileged.userAccount.findUniqueOrThrow({ where: { tenantId_id: { tenantId: fixture.tenantA.id, id } } });

  /** Chính chủ đăng nhập đúng một lần → trình duyệt giữ cookie máy quen. */
  async function familiarBrowser(username: string) {
    const agent = browser();
    const res = await login(agent, username);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return agent;
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
    fixture = await createTwoTenantFixture(privileged, 'SmartLockout e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('đăng nhập đúng đặt cookie máy quen: HttpOnly, theo từng tài khoản, chỉ gửi kèm /api/v1/auth', async () => {
    const a = await createUser();
    const b = await createUser();
    const agent = browser();
    const resA = await login(agent, a.username);
    const resB = await login(agent, b.username);
    const cookiesA = (resA.headers['set-cookie'] as unknown as string[]).filter((c) => c.startsWith('nx_dev_'));
    expect(cookiesA).toHaveLength(1);
    expect(cookiesA[0]).toContain(`nx_dev_${a.id.replace(/-/g, '')}=`);
    expect(cookiesA[0]).toMatch(/HttpOnly/i);
    expect(cookiesA[0]).toMatch(/Path=\/api\/v1\/auth/i);
    // Một trình duyệt dùng chung cho hai người vẫn giữ HAI cookie riêng.
    const cookiesB = (resB.headers['set-cookie'] as unknown as string[]).filter((c) => c.startsWith('nx_dev_'));
    expect(cookiesB[0]).toContain(`nx_dev_${b.id.replace(/-/g, '')}=`);
  });

  it('KẺ LẠ gõ sai 5 lần → máy lạ bị khoá tạm; CHÍNH CHỦ (máy quen) vẫn đăng nhập được và khoá được gỡ', async () => {
    const user = await createUser();
    const owner = await familiarBrowser(user.username);

    const stranger = browser();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await login(stranger, user.username, WRONG)).status);
    expect(statuses.slice(0, 4).every((s) => s === 401), JSON.stringify(statuses)).toBe(true);
    expect(statuses[4]).toBe(423);

    // Kẻ lạ nhập ĐÚNG mật khẩu vẫn bị chặn (máy lạ).
    expect((await login(stranger, user.username)).status).toBe(423);

    // Chính chủ trên máy quen KHÔNG bị liên luỵ.
    const ok = await login(owner, user.username);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = await rowOf(user.id);
    expect(row.lockedUntil).toBeNull();
    expect(row.lockoutLevel).toBe(0);
    expect(row.failedLoginCount).toBe(0);
  });

  it('KHOÁ VĨNH VIỄN do máy lạ: máy lạ bị chặn kể cả đúng mật khẩu; MÁY QUEN vẫn vào được, gỡ khoá và để lại nhật ký', async () => {
    const user = await createUser();
    const owner = await familiarBrowser(user.username);
    await privileged.userAccount.update({ where: { tenantId_id: { tenantId: fixture.tenantA.id, id: user.id } }, data: { lockoutLevel: 3, lockedPermanentlyAt: new Date() } });

    const stranger = browser();
    const blocked = await login(stranger, user.username);
    expect(blocked.status).toBe(423);
    expect(blocked.body.error.code).toBe('AUTH_ACCOUNT_LOCKED_PERMANENT');
    expect(blocked.body.error.message).toContain('máy bạn vẫn thường dùng');

    const ok = await login(owner, user.username);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = await rowOf(user.id);
    expect(row.lockedPermanentlyAt).toBeNull();
    expect(row.lockoutLevel).toBe(0);
    expect(await privileged.auditLog.count({ where: { tenantId: fixture.tenantA.id, entityId: user.id, action: 'auth.account_unlocked_by_trusted_device' } })).toBe(1);

    // Sau khi gỡ, kẻ lạ nhập đúng mật khẩu vào được như bình thường (khoá đã hết).
    expect((await login(stranger, user.username)).status).toBe(200);
  });

  it('máy quen gõ SAI không chạm bộ đếm của máy lạ; đủ 10 lần thì khoá TẠM 15 phút và chặn cả máy quen lẫn máy lạ — KHÔNG BAO GIỜ vĩnh viễn', async () => {
    const user = await createUser();
    const owner = await familiarBrowser(user.username);
    // Đặt sẵn 9 lần sai gần đây của máy quen (tránh bắn 10 yêu cầu vượt giới hạn tần suất 10/phút theo tài khoản).
    await privileged.userAccount.update({
      where: { tenantId_id: { tenantId: fixture.tenantA.id, id: user.id } },
      data: { familiarFailedLoginCount: 9, familiarLastFailedLoginAt: new Date() },
    });

    const tenth = await login(owner, user.username, WRONG);
    expect(tenth.status).toBe(423);
    expect(tenth.body.error.code).toBe('AUTH_ACCOUNT_LOCKED');
    const row = await rowOf(user.id);
    expect(row.familiarLockedUntil).not.toBeNull();
    expect(row.familiarLockedUntil!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(row.familiarLockedUntil!.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    // bộ đếm máy lạ không bị chạm; không có mốc vĩnh viễn
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockoutLevel).toBe(0);
    expect(row.lockedPermanentlyAt).toBeNull();

    // Đang trong khoá tạm của máy quen: đúng mật khẩu cũng bị chặn, cả máy quen lẫn máy lạ.
    expect((await login(owner, user.username)).status).toBe(423);
    expect((await login(browser(), user.username)).status).toBe(423);

    // Hết khoá → đăng nhập lại bình thường.
    await privileged.userAccount.update({ where: { tenantId_id: { tenantId: fixture.tenantA.id, id: user.id } }, data: { familiarLockedUntil: new Date(Date.now() - 1000) } });
    expect((await login(owner, user.username)).status).toBe(200);
  });

  it('cookie GIẢ MẠO hoặc của người khác KHÔNG được coi là máy quen (vẫn bị chặn khi tài khoản khoá vĩnh viễn)', async () => {
    const victim = await createUser();
    const other = await createUser();
    await privileged.userAccount.update({ where: { tenantId_id: { tenantId: fixture.tenantA.id, id: victim.id } }, data: { lockoutLevel: 3, lockedPermanentlyAt: new Date() } });

    // Cookie máy quen của NGƯỜI KHÁC gắn nhầm tên cookie của nạn nhân.
    const otherAgent = await familiarBrowser(other.username);
    const otherCookie = (await otherAgent.post('/api/v1/auth/login').send({ tenantId: fixture.tenantA.id, username: other.username, password })).headers['set-cookie'] as unknown as string[];
    const otherValue = otherCookie.find((c) => c.startsWith('nx_dev_'))!.split(';')[0]!.split('=')[1]!;
    const wrongOwner = await browser()
      .post('/api/v1/auth/login')
      .set('Cookie', `nx_dev_${victim.id.replace(/-/g, '')}=${otherValue}`)
      .send({ tenantId: fixture.tenantA.id, username: victim.username, password });
    expect(wrongOwner.status).toBe(423);

    // Cookie bịa hoàn toàn.
    const forged = await browser()
      .post('/api/v1/auth/login')
      .set('Cookie', `nx_dev_${victim.id.replace(/-/g, '')}=v1.${Math.floor(Date.now() / 1000)}.${'A'.repeat(43)}`)
      .send({ tenantId: fixture.tenantA.id, username: victim.username, password });
    expect(forged.status).toBe(423);
  });

  it('ĐỔI MẬT KHẨU làm máy quen cũ mất hiệu lực: tài khoản khoá vĩnh viễn thì máy cũ cũng bị chặn như máy lạ', async () => {
    const user = await createUser();
    const owner = await familiarBrowser(user.username);
    const newPassword = 'Mat-khau-moi@9876';
    await privileged.userAccount.update({
      where: { tenantId_id: { tenantId: fixture.tenantA.id, id: user.id } },
      data: { passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }), lockoutLevel: 3, lockedPermanentlyAt: new Date() },
    });
    const res = await login(owner, user.username, newPassword);
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('AUTH_ACCOUNT_LOCKED_PERMANENT');
  });

  it('quản trị bấm "Mở khoá" xoá cả khoá do máy quen lẫn khoá do máy lạ', async () => {
    const admin = await createUser('clinic_admin');
    const target = await createUser();
    await privileged.userAccount.update({
      where: { tenantId_id: { tenantId: fixture.tenantA.id, id: target.id } },
      data: { lockoutLevel: 2, lockedUntil: new Date(Date.now() + 10 * 60_000), familiarLockedUntil: new Date(Date.now() + 10 * 60_000), familiarFailedLoginCount: 4 },
    });
    const adminToken = (await login(browser(), admin.username)).body.data.accessToken as string;
    const version = (await rowOf(target.id)).version;
    const res = await request(app.getHttpServer()).post(`/api/v1/users/${target.id}/unlock`).set({ Authorization: `Bearer ${adminToken}` }).send({ version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await rowOf(target.id);
    expect(row.lockedUntil).toBeNull();
    expect(row.lockoutLevel).toBe(0);
    expect(row.familiarLockedUntil).toBeNull();
    expect(row.familiarFailedLoginCount).toBe(0);
  });

  it('công ty khác: cookie máy quen của tài khoản ở công ty A không có tác dụng ở công ty B', async () => {
    const userA = await createUser();
    const ownerCookie = ((await login(browser(), userA.username)).headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('nx_dev_'))!.split(';')[0]!;
    // Tạo tài khoản CÙNG tên ở công ty B và khoá vĩnh viễn; mang cookie của A sang.
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const userB = await privileged.userAccount.create({
      data: { tenantId: fixture.tenantB.id, username: userA.username, passwordHash, fullName: 'B', lockoutLevel: 3, lockedPermanentlyAt: new Date(), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    const res = await browser().post('/api/v1/auth/login').set('Cookie', ownerCookie.replace(userA.id.replace(/-/g, ''), userB.id.replace(/-/g, ''))).send({ tenantId: fixture.tenantB.id, username: userA.username, password });
    expect(res.status).toBe(423);
  });
});
