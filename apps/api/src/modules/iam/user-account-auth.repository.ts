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
}
