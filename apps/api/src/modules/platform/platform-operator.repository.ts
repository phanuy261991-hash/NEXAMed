import { Injectable } from '@nestjs/common';
import type { PlatformOperator } from '@prisma/client';
import type { LoginAttemptState } from '@nexamed/core';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `platform_operator` (người vận hành nền tảng, docs/DECISIONS.md #237). Bảng không có tenant_id/RLS — không thuộc công ty nào.
 * Khoá lạc quan bằng `version` như mọi bảng khác (cập nhật đếm lỗi đăng nhập ít khi đụng nhau nhưng vẫn kèm điều kiện).
 */
@Injectable()
export class PlatformOperatorRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUsername(username: string): Promise<PlatformOperator | null> {
    return this.prisma.platformOperator.findUnique({ where: { username } });
  }

  findById(id: string): Promise<PlatformOperator | null> {
    return this.prisma.platformOperator.findUnique({ where: { id } });
  }

  async recordFailedLogin(operator: PlatformOperator, state: LoginAttemptState): Promise<void> {
    await this.prisma.platformOperator.updateMany({
      where: { id: operator.id, version: operator.version },
      data: { failedLoginCount: state.failedLoginCount, lastFailedLoginAt: state.lastFailedLoginAt, lockedUntil: state.lockedUntil, version: { increment: 1 } },
    });
  }

  /**
   * Ghi nhận đăng nhập thành công VÀ "tiêu thụ" bước OTP trong CÙNG MỘT lệnh có điều kiện (RFC 6238 mục 5.2, docs/DECISIONS.md #244): chỉ thành công khi bước này LỚN HƠN bước đã
   * ghi. Trả `false` = mã đã dùng rồi (hoặc một yêu cầu song song vừa dùng nó) → nơi gọi từ chối. Không đọc-rồi-ghi nên hai yêu cầu cùng gửi một mã cùng lúc chỉ một yêu cầu qua.
   * Cố ý KHÔNG kèm điều kiện `version`: điều kiện bước OTP chính là chốt chặn, và điều kiện version sẽ làm đăng nhập đúng bị từ chối oan khi vừa có lần đăng nhập sai chen vào.
   */
  async consumeOtpStepAndRecordLogin(operatorId: string, step: number, now: Date): Promise<boolean> {
    const result = await this.prisma.platformOperator.updateMany({
      where: { id: operatorId, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: BigInt(step) } }] },
      data: { lastTotpStep: BigInt(step), failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, lastLoginAt: now, version: { increment: 1 } },
    });
    return result.count === 1;
  }
}
