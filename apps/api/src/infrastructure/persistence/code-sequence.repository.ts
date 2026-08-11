import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Cấp số tiếp theo cho một prefix mã hiển thị (`patient_code`, `encounter_no`...) theo tenant —
 * dùng chung mọi module cần sinh mã tuần tự (.claude/docs/data-model.md mục "Quy ước khác").
 *
 * Dùng `INSERT ... ON CONFLICT DO UPDATE` thay vì `SELECT ... FOR UPDATE` + `UPDATE` riêng —
 * cùng đạt tính atomic (Postgres tự khoá dòng bên trong một câu lệnh) nhưng gọn hơn, không cần
 * hai round-trip. Vẫn nằm trong transaction của caller (tham số `tx`) như
 * .claude/docs/multi-tenancy.md điều 7 yêu cầu ("cấp số trong transaction").
 */
@Injectable()
export class CodeSequenceRepository {
  async next(tx: Prisma.TransactionClient, tenantId: string, prefix: string, actorId: string): Promise<bigint> {
    const rows = await tx.$queryRaw<{ current_value: bigint }[]>`
      INSERT INTO code_sequence (tenant_id, prefix, current_value, created_by, updated_by)
      VALUES (${tenantId}::uuid, ${prefix}, 1, ${actorId}::uuid, ${actorId}::uuid)
      ON CONFLICT (tenant_id, prefix)
      DO UPDATE SET
        current_value = code_sequence.current_value + 1,
        updated_by = ${actorId}::uuid,
        updated_at = now(),
        version = code_sequence.version + 1
      RETURNING current_value
    `;
    const row = rows[0];
    if (!row) {
      throw new Error(`code_sequence: INSERT ... ON CONFLICT không trả dòng nào cho prefix "${prefix}".`);
    }
    return row.current_value;
  }
}
