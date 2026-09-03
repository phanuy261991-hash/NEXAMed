import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface NextCodeSequenceOptions {
  /** "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114) — '' (mặc định) = không reset, chạy
   * liên tục (đúng hành vi cũ). Khác '' thì bộ đếm của CHU KỲ đó bắt đầu riêng, độc lập chu kỳ khác. */
  periodKey?: string;
  /**
   * Giá trị khởi tạo cho lần INSERT đầu tiên TRÊN TOÀN BỘ lịch sử của `(tenantId, prefix)` — dùng
   * cho "số bắt đầu đếm" tự cấu hình (di dời số liệu từ hệ thống cũ). CHỈ áp dụng khi
   * `(tenantId, prefix)` CHƯA từng có bất kỳ dòng nào (mọi chu kỳ) — có rồi thì bỏ qua, chạy đúng
   * luồng cấp số bình thường (bao gồm cả khi chu kỳ MỚI bắt đầu ở lần sau, luôn bắt đầu lại từ 1,
   * KHÔNG lặp lại giá trị khởi tạo này — đó chỉ là mốc bootstrap MỘT LẦN duy nhất).
   */
  initialValueIfNeverUsed?: bigint;
}

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
  async next(
    tx: Prisma.TransactionClient,
    tenantId: string,
    prefix: string,
    actorId: string,
    opts: NextCodeSequenceOptions = {},
  ): Promise<bigint> {
    const periodKey = opts.periodKey ?? '';
    const initialValue = await this.resolveInitialValue(tx, tenantId, prefix, opts.initialValueIfNeverUsed);

    const rows = await tx.$queryRaw<{ current_value: bigint }[]>`
      INSERT INTO code_sequence (tenant_id, prefix, period_key, current_value, created_by, updated_by)
      VALUES (${tenantId}::uuid, ${prefix}, ${periodKey}, ${initialValue}, ${actorId}::uuid, ${actorId}::uuid)
      ON CONFLICT (tenant_id, prefix, period_key)
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

  /** Chỉ dùng giá trị khởi tạo tuỳ chỉnh khi `(tenantId, prefix)` CHƯA từng có dòng nào (bất kỳ
   * chu kỳ nào) — nếu không, INSERT lần này (chu kỳ mới) bắt đầu lại từ 1 như bình thường. */
  private async resolveInitialValue(
    tx: Prisma.TransactionClient,
    tenantId: string,
    prefix: string,
    initialValueIfNeverUsed: bigint | undefined,
  ): Promise<bigint> {
    if (initialValueIfNeverUsed === undefined) {
      return 1n;
    }
    const existing = await tx.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM code_sequence WHERE tenant_id = ${tenantId}::uuid AND prefix = ${prefix}) AS exists
    `;
    return existing[0]?.exists ? 1n : initialValueIfNeverUsed;
  }

  /** Có tồn tại bất kỳ dòng nào cho `(tenantId, prefix)` chưa (bỏ qua chu kỳ) — dùng để tính
   * `locked` của "Số bắt đầu đếm" ở "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114). */
  async hasEverBeenUsed(tx: Prisma.TransactionClient, tenantId: string, prefix: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM code_sequence WHERE tenant_id = ${tenantId}::uuid AND prefix = ${prefix}) AS exists
    `;
    return rows[0]?.exists ?? false;
  }

  /** Giá trị hiện tại của bộ đếm cho CHU KỲ đang hoạt động — chỉ dùng để tính "mã kế tiếp minh
   * hoạ" (preview, không cấp số/đụng DB). `null` nếu chu kỳ này chưa từng cấp số nào. */
  async peekCurrentValue(tx: Prisma.TransactionClient, tenantId: string, prefix: string, periodKey: string): Promise<bigint | null> {
    const rows = await tx.$queryRaw<{ current_value: bigint }[]>`
      SELECT current_value FROM code_sequence WHERE tenant_id = ${tenantId}::uuid AND prefix = ${prefix} AND period_key = ${periodKey}
    `;
    return rows[0]?.current_value ?? null;
  }
}
