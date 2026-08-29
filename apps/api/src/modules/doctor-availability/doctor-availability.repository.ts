import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { getVietnamDateString } from '@nexamed/core';
import type { DoctorAvailabilityStatus } from '@nexamed/shared';

export interface DoctorAvailabilityRow {
  doctorId: string;
  status: DoctorAvailabilityStatus;
  statusChangedAt: Date;
  reason: string | null;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `doctor_availability` — .claude/docs/coding-standards.md. Raw
 * SQL vì partial unique `(tenant_id, work_date, doctor_id) WHERE deleted_at IS NULL` không khai
 * báo được trong schema.prisma (điều kiện WHERE) — cùng lý do `doctor-room-session.repository.ts`
 * dùng `INSERT ... ON CONFLICT DO UPDATE` thay vì Prisma `upsert()`.
 */
@Injectable()
export class DoctorAvailabilityRepository {
  /** Đổi trạng thái giữa ngày = UPDATE tại chỗ (lịch sử đã có đủ ở audit_log qua action `doctor_availability.*`). */
  async upsertToday(
    tx: Prisma.TransactionClient,
    tenantId: string,
    doctorId: string,
    status: DoctorAvailabilityStatus,
    reason: string | null,
    actorId: string,
  ): Promise<void> {
    const workDate = getVietnamDateString();
    await tx.$executeRaw`
      INSERT INTO doctor_availability (tenant_id, doctor_id, work_date, status, status_changed_at, reason, created_by, updated_by)
      VALUES (${tenantId}::uuid, ${doctorId}::uuid, ${workDate}::date, ${status}::doctor_availability_status, now(), ${reason}, ${actorId}::uuid, ${actorId}::uuid)
      ON CONFLICT (tenant_id, work_date, doctor_id) WHERE deleted_at IS NULL
      DO UPDATE SET
        status = ${status}::doctor_availability_status,
        status_changed_at = now(),
        reason = ${reason},
        updated_by = ${actorId}::uuid,
        updated_at = now(),
        version = doctor_availability.version + 1
    `;
  }

  async findToday(tx: Prisma.TransactionClient, tenantId: string, doctorId: string): Promise<DoctorAvailabilityRow | null> {
    const workDate = getVietnamDateString();
    const rows = await tx.$queryRaw<{ doctor_id: string; status: DoctorAvailabilityStatus; status_changed_at: Date; reason: string | null }[]>`
      SELECT doctor_id, status, status_changed_at, reason
      FROM doctor_availability
      WHERE tenant_id = ${tenantId}::uuid AND doctor_id = ${doctorId}::uuid
        AND work_date = ${workDate}::date AND deleted_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    return row ? { doctorId: row.doctor_id, status: row.status, statusChangedAt: row.status_changed_at, reason: row.reason } : null;
  }

  /** Toàn bộ trạng thái hôm nay của tenant (mọi status, kể cả ACTIVE ghi tường minh lúc "Quay lại
   * làm việc") — bác sĩ không có dòng = ACTIVE ngầm định, service/board tự suy ra. */
  async listTodayForTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<DoctorAvailabilityRow[]> {
    const workDate = getVietnamDateString();
    const rows = await tx.$queryRaw<{ doctor_id: string; status: DoctorAvailabilityStatus; status_changed_at: Date; reason: string | null }[]>`
      SELECT doctor_id, status, status_changed_at, reason
      FROM doctor_availability
      WHERE tenant_id = ${tenantId}::uuid AND work_date = ${workDate}::date AND deleted_at IS NULL
    `;
    return rows.map((row) => ({ doctorId: row.doctor_id, status: row.status, statusChangedAt: row.status_changed_at, reason: row.reason }));
  }
}
