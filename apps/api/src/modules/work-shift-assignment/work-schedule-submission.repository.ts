import { Injectable } from '@nestjs/common';
import type { Prisma, WorkScheduleSubmission } from '@prisma/client';
import type { ScheduleSubmissionStatus } from '@nexamed/shared';

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `work_schedule_submission` (#225). Không có dòng = Nháp ảo; dòng được
 * tạo lúc gửi duyệt lần đầu (`upsertSubmitted`).
 */
@Injectable()
export class WorkScheduleSubmissionRepository {
  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<WorkScheduleSubmission | null> {
    return tx.workScheduleSubmission.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  findByUserMonth(tx: Prisma.TransactionClient, tenantId: string, userId: string, month: string): Promise<WorkScheduleSubmission | null> {
    return tx.workScheduleSubmission.findFirst({ where: { tenantId, userId, month, deletedAt: null } });
  }

  /** Trạng thái các tháng của MỘT nhân viên — `Map<month, status>`, thiếu = DRAFT. */
  async statusByMonth(tx: Prisma.TransactionClient, tenantId: string, userId: string, months: string[]): Promise<Map<string, ScheduleSubmissionStatus>> {
    if (months.length === 0) return new Map();
    const rows = await tx.workScheduleSubmission.findMany({ where: { tenantId, userId, month: { in: months }, deletedAt: null } });
    return new Map(rows.map((r) => [r.month, r.status as ScheduleSubmissionStatus]));
  }

  list(
    tx: Prisma.TransactionClient,
    tenantId: string,
    filter: { month?: string; status?: 'SUBMITTED' | 'APPROVED' | 'RETURNED'; userId?: string },
  ): Promise<WorkScheduleSubmission[]> {
    const where: Prisma.WorkScheduleSubmissionWhereInput = { tenantId, deletedAt: null };
    if (filter.month) where.month = filter.month;
    if (filter.userId) where.userId = filter.userId;
    if (filter.status === 'RETURNED') {
      where.status = 'DRAFT';
      where.returnReason = { not: null };
    } else if (filter.status) {
      where.status = filter.status;
    }
    return tx.workScheduleSubmission.findMany({ where, orderBy: [{ month: 'desc' }, { submittedAt: 'desc' }, { createdAt: 'desc' }], take: 500 });
  }

  countSubmitted(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    return tx.workScheduleSubmission.count({ where: { tenantId, status: 'SUBMITTED', deletedAt: null } });
  }

  /** Gửi duyệt: tạo dòng mới hoặc đưa dòng DRAFT (bị trả lại) về SUBMITTED. Trả `null` nếu dòng đã đổi (race). */
  async upsertSubmitted(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    userId: string,
    month: string,
    existing: WorkScheduleSubmission | null,
  ): Promise<WorkScheduleSubmission | null> {
    const now = new Date();
    if (!existing) {
      return tx.workScheduleSubmission.create({
        data: { tenantId, userId, month, status: 'SUBMITTED', submittedAt: now, createdBy: actorId, updatedBy: actorId },
      });
    }
    const result = await tx.workScheduleSubmission.updateMany({
      where: { tenantId, id: existing.id, version: existing.version, status: 'DRAFT', deletedAt: null },
      data: { status: 'SUBMITTED', submittedAt: now, returnReason: null, returnedAt: null, decidedBy: null, decidedAt: null, updatedBy: actorId, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.findById(tx, tenantId, existing.id);
  }

  /** Chuyển trạng thái có điều kiện (khoá lạc quan + đúng trạng thái nguồn). Trả số dòng đổi được. */
  async transition(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    version: number,
    from: ScheduleSubmissionStatus,
    data: { status: ScheduleSubmissionStatus; decidedBy?: string | null; decidedAt?: Date | null; returnReason?: string | null; returnedAt?: Date | null; submittedAt?: Date | null },
    actorId: string,
  ): Promise<number> {
    const result = await tx.workScheduleSubmission.updateMany({
      where: { tenantId, id, version, status: from, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
