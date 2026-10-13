import { Injectable } from '@nestjs/common';
import type { Prisma, UserSession } from '@prisma/client';

export interface CreateSessionInput {
  userId: string;
  /** Chi nhánh đang làm việc của phiên (#231) — null = chưa chọn. */
  branchId: string | null;
  refreshTokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Chỗ DUY NHẤT động vào `user_session` — xem .claude/docs/coding-standards.md.
 * `actorId` truyền vào các thao tác ghi luôn là chính `userId` chủ phiên (đăng nhập/refresh/
 * đăng xuất là hành động tự thân, không có actor nào khác) — không khai báo @relation cho
 * created_by/updated_by, theo docs/DECISIONS.md #005.
 */
@Injectable()
export class SessionRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, input: CreateSessionInput): Promise<UserSession> {
    return tx.userSession.create({
      data: {
        tenantId,
        userId: input.userId,
        branchId: input.branchId,
        refreshTokenHash: input.refreshTokenHash,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        ip: input.ip,
        userAgent: input.userAgent,
        createdBy: input.userId,
        updatedBy: input.userId,
      },
    });
  }

  findByHash(tx: Prisma.TransactionClient, tenantId: string, refreshTokenHash: string): Promise<UserSession | null> {
    return tx.userSession.findFirst({ where: { tenantId, refreshTokenHash } });
  }

  /** Đổi chi nhánh làm việc của phiên đang hoạt động (`POST /auth/switch-branch`, #231). */
  setBranch(tx: Prisma.TransactionClient, tenantId: string, sessionId: string, branchId: string, actorId: string): Promise<UserSession> {
    return tx.userSession.update({
      where: { tenantId_id: { tenantId, id: sessionId } },
      data: { branchId, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /**
   * Thu hồi một phiên (soft delete). Dùng cho logout, hết hạn, phát hiện reuse, và cho chính
   * rotation (khi đó `replacedBySessionId` trỏ sang phiên mới vừa tạo).
   */
  revoke(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sessionId: string,
    reason: string,
    actorId: string,
    replacedBySessionId?: string,
  ): Promise<UserSession> {
    return tx.userSession.update({
      where: { tenantId_id: { tenantId, id: sessionId } },
      data: {
        deletedAt: new Date(),
        deletedReason: reason,
        replacedBySessionId: replacedBySessionId ?? null,
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
  }

  /**
   * Thu hồi toàn bộ phiên còn hiệu lực của một user — dùng khi phát hiện refresh token bị
   * dùng lại (reuse), và sau này khi đổi vai trò/tenant (S2-07) theo security-audit.md.
   */
  revokeAllForUser(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    reason: string,
    actorId: string,
  ): Promise<Prisma.BatchPayload> {
    return tx.userSession.updateMany({
      where: { tenantId, userId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
  }
}
