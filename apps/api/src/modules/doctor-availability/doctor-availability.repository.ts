import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { getVietnamDateString } from '@nexamed/core';
import type { DoctorAvailabilityStatus } from '@nexamed/shared';

const ENFORCED_FROM_KEY = 'doctor_shift_close_enforced_from';

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
    /** Ngày lịch VN `YYYY-MM-DD`; mặc định hôm nay. Đóng ca bù cho ngày cũ truyền ngày đó vào. */
    workDate: string = getVietnamDateString(),
  ): Promise<void> {
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

  /** Các ngày trong `[from, to]` mà bác sĩ đã ở trạng thái ENDED (`YYYY-MM-DD`). Nhiều bác sĩ một lần: key = `doctorId`. */
  async listEndedDates(tx: Prisma.TransactionClient, tenantId: string, doctorIds: string[], from: string, to: string): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (doctorIds.length === 0) return result;
    const rows = await tx.$queryRaw<{ doctor_id: string; work_date: string }[]>`
      SELECT doctor_id, to_char(work_date, 'YYYY-MM-DD') AS work_date
      FROM doctor_availability
      WHERE tenant_id = ${tenantId}::uuid AND doctor_id = ANY(${doctorIds}::uuid[])
        AND work_date BETWEEN ${from}::date AND ${to}::date
        AND status = 'ENDED'::doctor_availability_status AND deleted_at IS NULL
    `;
    for (const row of rows) {
      const list = result.get(row.doctor_id) ?? [];
      list.push(row.work_date);
      result.set(row.doctor_id, list);
    }
    return result;
  }

  /**
   * Mốc "bắt đầu áp dụng đóng ca bắt buộc" của công ty (`tenant_setting`, khoá `doctor_shift_close_enforced_from`).
   * Ghi MỘT LẦN, lần đầu có người hỏi (= ngày hôm nay): ngày làm việc trước mốc này không bao giờ bị tính là chưa đóng —
   * nếu không, ngay khi nâng cấp mọi bác sĩ sẽ bị chặn vì hàng trăm ngày cũ chưa có bản ghi đóng ca. Công ty tạo mới
   * cũng được mốc là ngày đầu có người hỏi (không có lịch sử nên không mất gì). `ON CONFLICT DO NOTHING` chịu được
   * nhiều yêu cầu đồng thời.
   */
  async ensureEnforcedFrom(tx: Prisma.TransactionClient, tenantId: string, today: string, actorId: string): Promise<string> {
    await tx.$executeRaw`
      INSERT INTO tenant_setting (tenant_id, key, value_json, created_by, updated_by)
      VALUES (${tenantId}::uuid, ${ENFORCED_FROM_KEY}, ${JSON.stringify({ date: today })}::jsonb, ${actorId}::uuid, ${actorId}::uuid)
      ON CONFLICT (tenant_id, key) DO NOTHING
    `;
    const rows = await tx.$queryRaw<{ date: string | null }[]>`
      SELECT value_json->>'date' AS date FROM tenant_setting
      WHERE tenant_id = ${tenantId}::uuid AND key = ${ENFORCED_FROM_KEY} AND deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0]?.date ?? today;
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
