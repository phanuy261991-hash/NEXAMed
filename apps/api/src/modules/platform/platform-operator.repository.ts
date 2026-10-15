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

  async recordSuccessfulLogin(operator: PlatformOperator, now: Date): Promise<void> {
    await this.prisma.platformOperator.updateMany({
      where: { id: operator.id, version: operator.version },
      data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, lastLoginAt: now, version: { increment: 1 } },
    });
  }
}
