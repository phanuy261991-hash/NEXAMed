import { Injectable } from '@nestjs/common';
import type { Prisma, WorkShift, WorkShiftAssignment } from '@prisma/client';

export type WorkShiftAssignmentRow = WorkShiftAssignment & { workShift: WorkShift };

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `work_shift_assignment` — .claude/docs/coding-standards.md.
 * Dùng Prisma Client bình thường (không raw SQL) — partial unique `(tenant_id, user_id, work_date,
 * work_shift_id) WHERE deleted_at IS NULL` không khai báo được qua `@@unique` trong schema.prisma
 * (điều kiện WHERE), NHƯNG Postgres vẫn báo `unique_violation` (23505) bình thường khi `create()`
 * vi phạm, Prisma map về `P2002` dù index không được Prisma biết tới — đã xác nhận đúng cơ chế
 * này ở `PatientService`/`patient.national_id_hash` (comment trong `patient.service.ts`), không
 * cần raw SQL cho `INSERT` như `doctor_availability`/`doctor_room_session`.
 */
@Injectable()
export class WorkShiftAssignmentRepository {
  async create(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    workShiftId: string,
    workDate: string,
    actorId: string,
  ): Promise<WorkShiftAssignmentRow> {
    return tx.workShiftAssignment.create({
      data: { tenantId, userId, workShiftId, workDate: new Date(workDate), createdBy: actorId, updatedBy: actorId },
      include: { workShift: true },
    });
  }

  /**
   * `createMany({ skipDuplicates: true })` thay vì `create()` từng dòng trong vòng lặp — Postgres
   * ABORT CẢ TRANSACTION khi một câu lệnh trong đó vi phạm unique constraint, mọi câu lệnh tiếp
   * theo (kể cả sau khi JS `try/catch` "bắt" được lỗi) đều lỗi `25P02` cho tới khi rollback (bài
   * học đã ghi ở `sync-role-permissions.ts`). `skipDuplicates` sinh `ON CONFLICT DO NOTHING` không
   * chỉ định `conflict target` — khớp bất kỳ vi phạm unique nào kể cả index có điều kiện `WHERE`
   * không khai báo trong schema, dùng được cho đúng partial unique ở trên. Trả về SỐ DÒNG thật sự
   * tạo được — caller tự suy `skippedCount = tổng yêu cầu - createdCount`.
   */
  async createManySkipDuplicates(
    tx: Prisma.TransactionClient,
    rows: { tenantId: string; userId: string; workShiftId: string; workDate: Date; createdBy: string; updatedBy: string }[],
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await tx.workShiftAssignment.createMany({ data: rows, skipDuplicates: true });
    return result.count;
  }

  async findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<WorkShiftAssignmentRow | null> {
    return tx.workShiftAssignment.findFirst({ where: { tenantId, id, deletedAt: null }, include: { workShift: true } });
  }

  async softDelete(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    version: number,
    actorId: string,
    reason: string,
  ): Promise<number> {
    const result = await tx.workShiftAssignment.updateMany({
      where: { tenantId, id, version, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async list(
    tx: Prisma.TransactionClient,
    tenantId: string,
    filter: { from: string; to: string; userId?: string },
  ): Promise<WorkShiftAssignmentRow[]> {
    return tx.workShiftAssignment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        workDate: { gte: new Date(filter.from), lte: new Date(filter.to) },
        ...(filter.userId ? { userId: filter.userId } : {}),
      },
      include: { workShift: true },
      orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Dùng cho "Sao chép tuần trước" — toàn bộ ca đã đăng ký của 1 người trong khoảng ngày nguồn. */
  async listForUserInRange(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<WorkShiftAssignmentRow[]> {
    return tx.workShiftAssignment.findMany({
      where: { tenantId, userId, deletedAt: null, workDate: { gte: new Date(from), lte: new Date(to) } },
      include: { workShift: true },
    });
  }

  /**
   * Ca làm việc đã đăng ký của NHIỀU người cho ĐÚNG 1 ngày — dùng cho lưới Lịch hẹn
   * (`WorkShiftAssignmentReaderPort`, key = `userId`). `userIds` rỗng trả về mảng rỗng luôn, không
   * cần query (tránh `IN ()` không hợp lệ).
   */
  async listForUsersOnDate(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userIds: string[],
    date: string,
  ): Promise<WorkShiftAssignmentRow[]> {
    if (userIds.length === 0) return [];
    return tx.workShiftAssignment.findMany({
      where: { tenantId, userId: { in: userIds }, deletedAt: null, workDate: new Date(date) },
      include: { workShift: true },
    });
  }
}
