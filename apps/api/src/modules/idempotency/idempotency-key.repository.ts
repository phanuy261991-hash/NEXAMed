import { Injectable } from '@nestjs/common';
import type { IdempotencyKey, Prisma } from '@prisma/client';

export type IdempotencyKeyRow = IdempotencyKey;

/**
 * Chỗ DUY NHẤT gọi Prisma cho `idempotency_key` (docs/DECISIONS.md #257). Mọi hàm luôn ép `tenantId` (RLS vẫn là lớp phòng thủ cuối).
 * Bảng là dữ liệu kỹ thuật: giữ chỗ khoá bằng INSERT ... ON CONFLICT DO NOTHING (không cần khoá bi quan), chuyển trạng thái bằng UPDATE có điều kiện.
 */
@Injectable()
export class IdempotencyKeyRepository {
  /** Giữ chỗ khoá: `true` nếu CHÍNH yêu cầu này tạo được dòng (được quyền chạy nghiệp vụ), `false` nếu khoá đã tồn tại. */
  async claim(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    input: { requestKey: string; requestHash: string; method: string; path: string; expiresAt: Date },
  ): Promise<boolean> {
    const result = await tx.idempotencyKey.createMany({
      data: [{ tenantId, userId, ...input, status: 'IN_PROGRESS', createdBy: userId, updatedBy: userId }],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  find(tx: Prisma.TransactionClient, tenantId: string, userId: string, requestKey: string): Promise<IdempotencyKeyRow | null> {
    return tx.idempotencyKey.findUnique({ where: { tenantId_userId_requestKey: { tenantId, userId, requestKey } } });
  }

  /**
   * Tiếp quản dòng đã có (lần trước lỗi nghiệp vụ / treo / hết hạn) cho yêu cầu hiện tại. Khoá lạc quan theo `version` nên hai yêu cầu cùng tiếp quản
   * chỉ MỘT thắng. Trả `true` nếu thắng.
   */
  async takeOver(
    tx: Prisma.TransactionClient,
    tenantId: string,
    row: Pick<IdempotencyKeyRow, 'id' | 'version'>,
    input: { requestHash: string; method: string; path: string; actorId: string; expiresAt: Date },
  ): Promise<boolean> {
    const result = await tx.idempotencyKey.updateMany({
      where: { id: row.id, tenantId, version: row.version },
      data: {
        requestHash: input.requestHash,
        method: input.method,
        path: input.path,
        status: 'IN_PROGRESS',
        lockedAt: new Date(),
        completedAt: null,
        responseBodyEnc: null,
        expiresAt: input.expiresAt,
        updatedBy: input.actorId,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  /** Ghi phản hồi thành công (đã mã hoá, hoặc `null` nếu quá lớn không lưu). Chỉ chuyển được từ IN_PROGRESS. */
  async complete(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, responseBodyEnc: Buffer | null): Promise<boolean> {
    const result = await tx.idempotencyKey.updateMany({
      where: { id, tenantId, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', completedAt: new Date(), responseBodyEnc, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  }

  /** Nhả khoá khi nghiệp vụ lỗi (chưa ghi gì) để người dùng sửa rồi gửi lại cùng khoá. */
  async fail(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string): Promise<boolean> {
    const result = await tx.idempotencyKey.updateMany({
      where: { id, tenantId, status: 'IN_PROGRESS' },
      data: { status: 'FAILED', completedAt: new Date(), responseBodyEnc: null, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  }

  /**
   * Xoá cứng dòng đã quá hạn (NGOẠI LỆ với "cấm DELETE", xem migration 20261023100000) — dữ liệu kỹ thuật, không phải hồ sơ nghiệp vụ. Chỉ job nền gọi;
   * luôn ép `tenantId` + `expiresAt < cutoff` trong câu lệnh.
   */
  async purgeExpired(tx: Prisma.TransactionClient, tenantId: string, cutoff: Date): Promise<number> {
    const result = await tx.idempotencyKey.deleteMany({ where: { tenantId, expiresAt: { lt: cutoff } } });
    return result.count;
  }
}
