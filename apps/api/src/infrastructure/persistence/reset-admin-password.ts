import * as argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';
import { generateTempPassword } from '../crypto/temp-password';
import { writeAuditLog } from './audit-log.helper';
import type { UnitOfWorkService } from './unit-of-work.service';

/**
 * Đặt lại mật khẩu một tài khoản bằng DÒNG LỆNH (`db:reset-admin-password`) cho trường hợp tài khoản quản trị duy nhất quên mật khẩu — giao diện không giúp được
 * vì không ai còn đăng nhập để bấm "Đặt lại mật khẩu" (docs/Deploy.md mục 2.3). Cùng hiệu ứng với `UserAccountService.resetPassword()`: mật khẩu mới (tạm, bắt đổi ở lần
 * đăng nhập đầu), xoá khoá tạm đăng nhập sai, thu hồi MỌI phiên đang mở, ghi `audit_log` (`user_account.password_reset`, không có người thực hiện — thao tác tại máy chủ).
 * Chạy bằng role ỨNG DỤNG trong phạm vi RLS của đúng một công ty (không dùng role đặc quyền), nên không thể chạm công ty khác.
 */
export class ResetAdminPasswordError extends Error {}

export interface ResetAdminPasswordOptions {
  username: string;
  /** Bắt buộc khi hệ thống có nhiều hơn một công ty (SaaS); một công ty thì tự nhận. */
  tenantId?: string;
  /** Không truyền thì tự sinh mật khẩu tạm dạng `XXXX-XXXX-XXXX`. */
  newPassword?: string;
}

export interface ResetAdminPasswordResult {
  tenantId: string;
  tenantName: string;
  userId: string;
  username: string;
  fullName: string;
  password: string;
  generated: boolean;
}

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const MIN_PASSWORD_LENGTH = 12;

export async function resetAdminPassword(
  prisma: PrismaClient,
  unitOfWork: Pick<UnitOfWorkService, 'runInTenantScope'>,
  options: ResetAdminPasswordOptions,
): Promise<ResetAdminPasswordResult> {
  const username = options.username.trim();
  if (!username) throw new ResetAdminPasswordError('Thiếu tên đăng nhập cần đặt lại mật khẩu.');
  if (options.newPassword !== undefined && options.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ResetAdminPasswordError(`Mật khẩu mới cần từ ${MIN_PASSWORD_LENGTH} ký tự (hoặc bỏ trống để hệ thống tự sinh).`);
  }

  const tenants = await prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (tenants.length === 0) throw new ResetAdminPasswordError('Hệ thống chưa có phòng khám nào.');
  let tenant: { id: string; name: string } | undefined;
  if (options.tenantId) {
    tenant = tenants.find((t) => t.id === options.tenantId);
    if (!tenant) throw new ResetAdminPasswordError(`Không có phòng khám mã ${options.tenantId}.`);
  } else if (tenants.length === 1) {
    tenant = tenants[0];
  } else {
    throw new ResetAdminPasswordError(`Hệ thống có ${tenants.length} công ty — truyền TENANT_ID. Danh sách: ${tenants.map((t) => `${t.id} (${t.name})`).join('; ')}`);
  }

  const generated = options.newPassword === undefined;
  const password = options.newPassword ?? generateTempPassword();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const tenantId = tenant!.id;

  const user = await unitOfWork.runInTenantScope(tenantId, async (tx) => {
    const found = await tx.userAccount.findFirst({ where: { tenantId, username, deletedAt: null }, select: { id: true, username: true, fullName: true, isActive: true } });
    if (!found) throw new ResetAdminPasswordError(`Không có tài khoản "${username}" trong phòng khám "${tenant!.name}".`);
    if (!found.isActive) {
      throw new ResetAdminPasswordError(`Tài khoản "${username}" đang bị vô hiệu hoá (ví dụ trạng thái làm việc "Nghỉ việc"). Hãy dùng tài khoản quản trị khác để kích hoạt lại, hoặc đặt lại bằng tài khoản quản trị còn hoạt động.`);
    }
    await tx.userAccount.update({
      where: { tenantId_id: { tenantId, id: found.id } },
      data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, updatedBy: SYSTEM_ACTOR, version: { increment: 1 } },
    });
    await tx.userSession.updateMany({
      where: { tenantId, userId: found.id, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'password_reset', updatedBy: SYSTEM_ACTOR, version: { increment: 1 } },
    });
    await writeAuditLog(tx, tenantId, { actorId: null, action: 'user_account.password_reset', entityType: 'user_account', entityId: found.id, afterJson: { via: 'command_line' } });
    return found;
  });

  return { tenantId, tenantName: tenant!.name, userId: user.id, username: user.username, fullName: user.fullName, password, generated };
}
