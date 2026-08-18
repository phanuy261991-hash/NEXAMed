import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { getVietnamDateString } from '@nexamed/core';
import type { RoomSession } from '@nexamed/shared';

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `doctor_room_session` (docs/DECISIONS.md #054) —
 * .claude/docs/coding-standards.md. Raw SQL vì partial unique `(tenant_id, work_date, doctor_id)
 * WHERE deleted_at IS NULL` không khai báo được trong schema.prisma (điều kiện WHERE) — cùng lý
 * do `code-sequence.repository.ts` dùng `INSERT ... ON CONFLICT DO UPDATE` thay vì Prisma
 * `upsert()` (Prisma `upsert()` không nhắm được arbiter là partial unique index).
 */
@Injectable()
export class DoctorRoomSessionRepository {
  /** Đổi phòng giữa ngày = UPDATE tại chỗ (không phải dữ liệu lâm sàng cần giữ lịch sử bất biến). */
  async upsertToday(tx: Prisma.TransactionClient, tenantId: string, doctorId: string, roomId: string, actorId: string): Promise<void> {
    const workDate = getVietnamDateString();
    await tx.$executeRaw`
      INSERT INTO doctor_room_session (tenant_id, doctor_id, room_id, work_date, created_by, updated_by)
      VALUES (${tenantId}::uuid, ${doctorId}::uuid, ${roomId}::uuid, ${workDate}::date, ${actorId}::uuid, ${actorId}::uuid)
      ON CONFLICT (tenant_id, work_date, doctor_id) WHERE deleted_at IS NULL
      DO UPDATE SET
        room_id = ${roomId}::uuid,
        updated_by = ${actorId}::uuid,
        updated_at = now(),
        version = doctor_room_session.version + 1
    `;
  }

  async findToday(tx: Prisma.TransactionClient, tenantId: string, doctorId: string): Promise<RoomSession | null> {
    const workDate = getVietnamDateString();
    const rows = await tx.$queryRaw<{ room_id: string; room_name: string }[]>`
      SELECT s.room_id, r.name AS room_name
      FROM doctor_room_session s
      JOIN room r ON r.tenant_id = s.tenant_id AND r.id = s.room_id
      WHERE s.tenant_id = ${tenantId}::uuid AND s.doctor_id = ${doctorId}::uuid
        AND s.work_date = ${workDate}::date AND s.deleted_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    return row ? { roomId: row.room_id, roomName: row.room_name, workDate } : null;
  }

  /**
   * Phân công hôm nay của TOÀN tenant (key = doctorId) — nguồn cho
   * `ClinicConfigReaderPort.getTodayDoctorRoomAssignments()`, tận dụng đúng index arbiter ở trên
   * làm leftmost-prefix (tenant_id, work_date) — xem comment thứ tự cột trong migration.
   */
  async listActiveForTenantToday(tx: Prisma.TransactionClient, tenantId: string): Promise<Record<string, { roomId: string; roomName: string }>> {
    const workDate = getVietnamDateString();
    const rows = await tx.$queryRaw<{ doctor_id: string; room_id: string; room_name: string }[]>`
      SELECT s.doctor_id, s.room_id, r.name AS room_name
      FROM doctor_room_session s
      JOIN room r ON r.tenant_id = s.tenant_id AND r.id = s.room_id
      WHERE s.tenant_id = ${tenantId}::uuid AND s.work_date = ${workDate}::date AND s.deleted_at IS NULL
    `;
    const result: Record<string, { roomId: string; roomName: string }> = {};
    for (const row of rows) {
      result[row.doctor_id] = { roomId: row.room_id, roomName: row.room_name };
    }
    return result;
  }
}
