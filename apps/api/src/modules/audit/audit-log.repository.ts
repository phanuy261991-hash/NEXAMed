import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditLog } from '@prisma/client';
import { systemLogEntityTypes } from '@nexamed/core';

export interface ListAuditLogParams {
  cursor?: string;
  take: number;
  /** Toàn bộ id lượt khám thuộc bệnh nhân đang lọc — đã tra qua `EncounterReaderPort` ở service. */
  patientId?: string;
  encounterIdsForPatient?: string[];
  actorId?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `audit_log` ngoài `audit-log.helper.ts` (ghi) — theo
 * .claude/docs/coding-standards.md. Chỉ đọc (S5-05, ADM-03), không ghi.
 */
@Injectable()
export class AuditLogRepository {
  /**
   * Lọc "theo bệnh nhân" trả về ĐẦY ĐỦ dấu vết hồ sơ bệnh án — không chỉ `entityType='patient'`
   * (tạo/sửa hồ sơ hành chính) mà còn mọi dòng `entityType='encounter'` của các lượt khám thuộc
   * bệnh nhân đó (sửa chẩn đoán/ghi chú khám/kê đơn/hoàn tất khám đều ghi audit_log kiểu này) —
   * quyết định đã chốt ở kế hoạch S5-05, đúng tinh thần ADM-03 "ai sửa hồ sơ nào".
   */
  list(tx: Prisma.TransactionClient, tenantId: string, params: ListAuditLogParams): Promise<AuditLog[]> {
    const where: Prisma.AuditLogWhereInput = { tenantId };
    if (params.actorId) {
      where.actorId = params.actorId;
    }
    if (params.occurredFrom || params.occurredTo) {
      where.occurredAt = {
        ...(params.occurredFrom ? { gte: params.occurredFrom } : {}),
        ...(params.occurredTo ? { lt: params.occurredTo } : {}),
      };
    }
    if (params.patientId) {
      where.OR = [
        { entityType: 'patient', entityId: params.patientId },
        { entityType: 'encounter', entityId: { in: params.encounterIdsForPatient ?? [] } },
      ];
    }
    return tx.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: params.take,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
  }

  /**
   * Xoá "System Log" quá `cutoff` (chính sách lưu trữ 2 tầng, `packages/core/src/audit/
   * log-retention.ts`) — CHỖ DUY NHẤT trong toàn bộ codebase gọi `deleteMany` trên `audit_log`.
   * `WHERE entityType IN (...)` ép cứng theo `systemLogEntityTypes()`, không nhận tham số ngoài nào
   * mở rộng phạm vi xoá — không controller/endpoint nào gọi hàm này, chỉ `SystemLogPurgeJob` (job
   * nền `@Cron`). RLS (`app.current_tenant_id`) tự giới hạn đúng 1 tenant mỗi lần gọi, đúng
   * `runInTenantScope()` ở service — không cần thêm `tenantId` vào `where` ở đây.
   */
  async purgeSystemLogsOlderThan(tx: Prisma.TransactionClient, cutoff: Date): Promise<number> {
    const result = await tx.auditLog.deleteMany({
      where: { entityType: { in: systemLogEntityTypes() }, occurredAt: { lt: cutoff } },
    });
    return result.count;
  }
}
