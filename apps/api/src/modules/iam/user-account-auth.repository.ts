import { Injectable } from '@nestjs/common';
import type { Prisma, UserAccount } from '@prisma/client';
import type { LoginAttemptState } from '@nexamed/core';

/**
 * Chỉ phần đọc/ghi `user_account` phục vụ đăng nhập (tra cứu, đếm đăng nhập sai, khoá tạm).
 * CRUD tài khoản đầy đủ (tạo/sửa/gán vai trò) thuộc S2-07 — không lặp lại ở đây.
 */
@Injectable()
export class UserAccountAuthRepository {
  findByUsername(tx: Prisma.TransactionClient, tenantId: string, username: string): Promise<UserAccount | null> {
    return tx.userAccount.findFirst({ where: { tenantId, username, deletedAt: null } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<UserAccount | null> {
    return tx.userAccount.findFirst({ where: { tenantId, id: userId, deletedAt: null } });
  }

  recordFailedLogin(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    state: LoginAttemptState,
  ): Promise<UserAccount> {
    return tx.userAccount.update({
      where: { tenantId_id: { tenantId, id: userId } },
      data: {
        failedLoginCount: state.failedLoginCount,
        lastFailedLoginAt: state.lastFailedLoginAt,
        lockedUntil: state.lockedUntil,
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
  }

  recordSuccessfulLogin(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<UserAccount> {
    return tx.userAccount.update({
      where: { tenantId_id: { tenantId, id: userId } },
      data: {
        failedLoginCount: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
  }

  /** Tự đổi mật khẩu (mở rộng ADM-01, `AuthService.changePassword`) — luôn xoá cờ `mustChangePassword`. */
  updatePasswordAndClearMustChange(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    passwordHash: string,
  ): Promise<UserAccount> {
    return tx.userAccount.update({
      where: { tenantId_id: { tenantId, id: userId } },
      data: { passwordHash, mustChangePassword: false, updatedBy: userId, version: { increment: 1 } },
    });
  }

  /**
   * Tên các vai trò đã gán cho user — dùng cho `loginResponseSchema.user.roles` và `GET /auth/me`
   * (S1-08, docs/DECISIONS.md #022) để web ẩn/hiện menu theo vai trò. Không phải guard phân quyền
   * thật (đó là việc của S2 đọc `role_permission`/`data_scope`) — chỉ trả tên vai trò để hiển thị.
   */
  async findRoleNamesForUser(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<string[]> {
    // deletedAt: null bắt buộc — thiếu điều kiện này chưa từng lộ vấn đề vì trước S2-07 chưa có
    // đường nào soft-delete user_role (không có gán lại vai trò). Từ S2-07,
    // UserAccountRepository.replaceUserRoles() soft-delete gán cũ khi đổi vai trò, thiếu filter
    // này sẽ khiến vai trò đã gỡ vẫn hiện ở đây (login response, GET /auth/me).
    const rows = await tx.userRole.findMany({ where: { tenantId, userId, deletedAt: null }, include: { role: true } });
    return rows.map((r) => r.role.name);
  }
}
