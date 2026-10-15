import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { PrismaService } from './prisma.service';
import { UnitOfWorkService } from './unit-of-work.service';
import { ResetAdminPasswordError, resetAdminPassword } from './reset-admin-password';

// `db:reset-admin-password` (docs/Deploy.md 2.3): đặt lại mật khẩu bằng dòng lệnh khi quản trị viên duy nhất quên mật khẩu.
describe('resetAdminPassword', () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService();
  const unitOfWork = new UnitOfWorkService(appPrisma);
  let fixture: TwoTenantFixture;
  const users: Record<string, { id: string }> = {};

  async function makeUser(tenantId: string, username: string, extra: { isActive?: boolean } = {}) {
    return privileged.userAccount.create({
      data: {
        tenantId,
        username,
        passwordHash: await argon2.hash('Mat-khau-cu-12345', { type: argon2.argon2id }),
        fullName: `Họ tên ${username}`,
        mustChangePassword: false,
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() + 10 * 60_000),
        isActive: extra.isActive ?? true,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
  }

  async function makeSession(tenantId: string, userId: string) {
    return privileged.userSession.create({
      data: { tenantId, userId, refreshTokenHash: `h-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
  }

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();
    fixture = await createTwoTenantFixture(privileged, 'ResetAdminPw');
    users.a = await makeUser(fixture.tenantA.id, 'quantri');
    users.b = await makeUser(fixture.tenantB.id, 'quantri'); // CÙNG tên đăng nhập ở công ty khác — không được bị đụng
    users.off = await makeUser(fixture.tenantA.id, 'nghiviec', { isActive: false });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  it('đặt mật khẩu tạm mới (đăng nhập được bằng mật khẩu mới, không còn bằng mật khẩu cũ), bắt đổi, xoá khoá tạm, thu hồi phiên, ghi audit', async () => {
    const live = await makeSession(fixture.tenantA.id, users.a!.id);
    const result = await resetAdminPassword(appPrisma, unitOfWork, { username: 'quantri', tenantId: fixture.tenantA.id });

    expect(result.generated).toBe(true);
    expect(result.password).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    const after = await privileged.userAccount.findUniqueOrThrow({ where: { id: users.a!.id } });
    expect(await argon2.verify(after.passwordHash, result.password)).toBe(true);
    expect(await argon2.verify(after.passwordHash, 'Mat-khau-cu-12345')).toBe(false);
    expect(after.mustChangePassword).toBe(true);
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
    expect(after.version).toBe(2);

    const session = await privileged.userSession.findUniqueOrThrow({ where: { id: live.id } });
    expect(session.deletedAt).not.toBeNull();
    expect(session.deletedReason).toBe('password_reset');

    const audit = await privileged.auditLog.findFirst({ where: { tenantId: fixture.tenantA.id, action: 'user_account.password_reset', entityId: users.a!.id } });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBeNull();
  });

  it('CÔ LẬP CÔNG TY: tài khoản trùng tên ở công ty khác không bị đổi mật khẩu', async () => {
    const other = await privileged.userAccount.findUniqueOrThrow({ where: { id: users.b!.id } });
    expect(await argon2.verify(other.passwordHash, 'Mat-khau-cu-12345')).toBe(true);
    expect(other.version).toBe(1);
    expect(other.failedLoginCount).toBe(5);
  });

  it('dùng mật khẩu do người chạy lệnh đặt (từ 12 ký tự), không tự sinh', async () => {
    const result = await resetAdminPassword(appPrisma, unitOfWork, { username: 'quantri', tenantId: fixture.tenantA.id, newPassword: 'Mat-khau-moi-2026!' });
    expect(result.generated).toBe(false);
    const after = await privileged.userAccount.findUniqueOrThrow({ where: { id: users.a!.id } });
    expect(await argon2.verify(after.passwordHash, 'Mat-khau-moi-2026!')).toBe(true);
  });

  it('mật khẩu tự đặt quá ngắn bị từ chối, mật khẩu cũ giữ nguyên', async () => {
    const before = await privileged.userAccount.findUniqueOrThrow({ where: { id: users.a!.id } });
    await expect(resetAdminPassword(appPrisma, unitOfWork, { username: 'quantri', tenantId: fixture.tenantA.id, newPassword: 'ngan' })).rejects.toThrow('từ 12 ký tự');
    const after = await privileged.userAccount.findUniqueOrThrow({ where: { id: users.a!.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('báo lỗi rõ ràng: tài khoản không tồn tại, tài khoản bị vô hiệu hoá, mã công ty sai', async () => {
    await expect(resetAdminPassword(appPrisma, unitOfWork, { username: 'khong-co', tenantId: fixture.tenantA.id })).rejects.toThrow('Không có tài khoản');
    await expect(resetAdminPassword(appPrisma, unitOfWork, { username: 'nghiviec', tenantId: fixture.tenantA.id })).rejects.toThrow('vô hiệu hoá');
    await expect(resetAdminPassword(appPrisma, unitOfWork, { username: 'quantri', tenantId: randomUUID() })).rejects.toThrow('Không có phòng khám');
    await expect(resetAdminPassword(appPrisma, unitOfWork, { username: '  ' })).rejects.toBeInstanceOf(ResetAdminPasswordError);
  });

  it('có nhiều công ty mà không truyền TENANT_ID thì từ chối và liệt kê công ty để chọn', async () => {
    await expect(resetAdminPassword(appPrisma, unitOfWork, { username: 'quantri' })).rejects.toThrow('truyền TENANT_ID');
  });
});
