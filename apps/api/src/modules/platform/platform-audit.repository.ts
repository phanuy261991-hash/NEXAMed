import { Injectable } from '@nestjs/common';
import type { Prisma, PlatformAuditLog } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

export interface PlatformAuditEntryInput {
  operatorId: string | null;
  action: string;
  targetTenantId?: string | null;
  /** Lý do/ghi chú đi kèm — KHÔNG đưa mật khẩu hay dữ liệu bệnh nhân vào đây. */
  note?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Chỗ duy nhất gọi Prisma cho `platform_audit_log` — append-only (app role không UPDATE/DELETE bảng này). */
@Injectable()
export class PlatformAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(entry: PlatformAuditEntryInput): Promise<void> {
    await this.prisma.platformAuditLog.create({
      data: {
        operatorId: entry.operatorId,
        action: entry.action,
        targetTenantId: entry.targetTenantId ?? null,
        detailJson: entry.note ? ({ note: entry.note } satisfies Prisma.InputJsonObject) : undefined,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }

  list(params: { tenantId?: string; cursor?: string; take: number }): Promise<PlatformAuditLog[]> {
    return this.prisma.platformAuditLog.findMany({
      where: params.tenantId ? { targetTenantId: params.tenantId } : {},
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: params.take,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
  }
}
