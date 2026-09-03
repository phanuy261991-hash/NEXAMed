import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

/** `$queryRaw` có mặt trên cả `PrismaClient` (seed script chạy ngoài transaction) lẫn
 * `Prisma.TransactionClient` (mọi service khác) — không cần ép kiểu riêng cho từng nơi gọi. */
type QueryableClient = Pick<PrismaClient, '$queryRaw'> | Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Cấp số tiếp theo cho mã NGẮN, TUẦN TỰ của danh mục TOÀN HỆ THỐNG (reference_catalog/
 * allergen_catalog, docs/DECISIONS.md #113) — khác `CodeSequenceRepository` (theo tenant, dùng
 * cho mã nghiệp vụ có tháng-năm). Cùng kỹ thuật atomic `INSERT ... ON CONFLICT DO UPDATE`.
 */
@Injectable()
export class GlobalCodeSequenceRepository {
  async next(client: QueryableClient, prefix: string): Promise<bigint> {
    const rows = await client.$queryRaw<{ current_value: bigint }[]>`
      INSERT INTO global_code_sequence (prefix, current_value)
      VALUES (${prefix}, 1)
      ON CONFLICT (prefix)
      DO UPDATE SET current_value = global_code_sequence.current_value + 1
      RETURNING current_value
    `;
    const row = rows[0];
    if (!row) {
      throw new Error(`global_code_sequence: INSERT ... ON CONFLICT không trả dòng nào cho prefix "${prefix}".`);
    }
    return row.current_value;
  }
}
