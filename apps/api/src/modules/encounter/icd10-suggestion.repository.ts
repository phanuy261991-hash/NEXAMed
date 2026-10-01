import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Icd10SuggestionCandidate } from '@nexamed/core';

/** Số ứng viên tối đa lấy từ DB cho MỖI cụm bệnh, trước khi `rankIcd10Candidates` chấm điểm và cắt còn 3. */
const CANDIDATE_LIMIT = 80;

/**
 * Chỗ DUY NHẤT gọi Prisma/SQL cho "Gợi ý mã ICD-10" (đọc `icd10_catalog`/`diagnosis`, đọc-ghi
 * `icd10_phrase_usage`) — theo `coding-standards.md`. Không có ranking/logic nghiệp vụ ở đây, việc đó
 * thuộc `packages/core` (`rankIcd10Candidates`).
 */
@Injectable()
export class Icd10SuggestionRepository {
  /**
   * Từ điển viết tắt đang dùng (`reference_catalog` category `ICD10_ABBREVIATION`, #206) — chỉ mục còn
   * hiệu lực. Bảng dùng chung toàn hệ thống (không `tenant_id`), cùng loại dữ liệu nền với `icd10_catalog`
   * ở các hàm bên dưới. Vài chục dòng, đọc mỗi lần gợi ý (không cache) để admin sửa là có hiệu lực ngay.
   */
  async listActiveAbbreviations(tx: Prisma.TransactionClient): Promise<{ abbreviation: string; expansion: string }[]> {
    const rows = await tx.referenceCatalog.findMany({
      where: { category: 'ICD10_ABBREVIATION', isActive: true },
      select: { code: true, name: true },
    });
    return rows.map((r) => ({ abbreviation: r.code, expansion: r.name }));
  }

  /**
   * Ứng viên cho 1 cụm bệnh: khớp NGUYÊN TỪ (biên từ `\m..\M`, không khớp giữa từ — "tha" không khớp
   * "thai") trên `search_key` (tên đã bỏ dấu, GIN trigram hỗ trợ regex). ≥ 4 từ thì cho phép thiếu tối
   * đa 1 từ (đúng `allowedMisses` của ranker). Chỉ lấy mã dùng được (`is_billable`), lọc giới tính ở
   * DB. Sắp theo tên NGẮN trước để mã chung (ví dụ "Sốt, không xác định") không bị mã dài chen mất chỗ.
   * `strippedTokens` PHẢI đã bỏ dấu + chỉ chữ/số (hàm tự lọc thêm một lượt phòng thủ).
   */
  async findCandidates(
    tx: Prisma.TransactionClient,
    strippedTokens: readonly string[],
    patientGender: string | null,
  ): Promise<Icd10SuggestionCandidate[]> {
    const tokens = strippedTokens.map((t) => t.replace(/[^a-z0-9]/g, '')).filter((t) => t !== '');
    if (tokens.length === 0) {
      return [];
    }
    const wordMatch = (token: string) => Prisma.sql`"search_key" ~ ${`\\m${token}\\M`}`;
    const allOf = (list: string[]) => Prisma.join(list.map(wordMatch), ' AND ');
    const combos: Prisma.Sql[] = [Prisma.sql`(${allOf(tokens)})`];
    if (tokens.length >= 4) {
      for (let skip = 0; skip < tokens.length; skip += 1) {
        combos.push(Prisma.sql`(${allOf(tokens.filter((_, i) => i !== skip))})`);
      }
    }
    const genderFilter =
      patientGender === null
        ? Prisma.sql`"gender_restriction" IS NULL`
        : Prisma.sql`("gender_restriction" IS NULL OR "gender_restriction"::text = ${patientGender})`;

    const rows = await tx.$queryRaw<{ code: string; nameVi: string; genderRestriction: 'male' | 'female' | null; isBillable: boolean }[]>(Prisma.sql`
      SELECT "code", "name_vi" AS "nameVi", "gender_restriction"::text AS "genderRestriction", "is_billable" AS "isBillable"
      FROM "icd10_catalog"
      WHERE "is_billable" = true AND ${genderFilter} AND (${Prisma.join(combos, ' OR ')})
      ORDER BY length("name_vi"), "code"
      LIMIT ${CANDIDATE_LIMIT}
    `);
    return rows;
  }

  /** Mã đã học cho 1 cụm nhưng tên mã KHÔNG chứa từ khoá của cụm (ví dụ "cảm" → J06.9) — vẫn phải vào danh sách ứng viên. */
  async findByCodes(tx: Prisma.TransactionClient, codes: readonly string[], patientGender: string | null): Promise<Icd10SuggestionCandidate[]> {
    if (codes.length === 0) {
      return [];
    }
    const rows = await tx.icd10Catalog.findMany({
      where: { code: { in: [...codes] }, isBillable: true },
      select: { code: true, nameVi: true, genderRestriction: true, isBillable: true },
    });
    return rows.filter((r) => r.genderRestriction === null || r.genderRestriction === patientGender);
  }

  /** Số lần CHÍNH bác sĩ này đã có mã trong chẩn đoán ĐÃ KÝ (12 tháng gần nhất) — chỉ trên tập mã ứng viên. Dùng partial index `diagnosis_tenant_id_created_by_icd10_code_signed_idx`. */
  async countDoctorUsage(tx: Prisma.TransactionClient, tenantId: string, doctorId: string, codes: readonly string[]): Promise<Record<string, number>> {
    if (codes.length === 0) {
      return {};
    }
    const rows = await tx.$queryRaw<{ code: string; count: number }[]>(Prisma.sql`
      SELECT "icd10_code" AS "code", COUNT(*)::int AS "count"
      FROM "diagnosis"
      WHERE "tenant_id" = ${tenantId}::uuid AND "created_by" = ${doctorId}::uuid
        AND "signed_at" IS NOT NULL AND "deleted_at" IS NULL
        AND "signed_at" >= now() - interval '12 months'
        AND "icd10_code" IN (${Prisma.join([...codes])})
      GROUP BY "icd10_code"
    `);
    return Object.fromEntries(rows.map((r) => [r.code, r.count]));
  }

  /** Mã đã học của bác sĩ theo từng cụm từ: `{ [phraseKey]: { [code]: usageCount } }`. */
  async findPhraseUsage(
    tx: Prisma.TransactionClient,
    tenantId: string,
    doctorId: string,
    phraseKeys: readonly string[],
  ): Promise<Record<string, Record<string, number>>> {
    if (phraseKeys.length === 0) {
      return {};
    }
    const rows = await tx.icd10PhraseUsage.findMany({
      where: { tenantId, doctorId, phraseKey: { in: [...phraseKeys] }, deletedAt: null },
      select: { phraseKey: true, icd10Code: true, usageCount: true },
    });
    const result: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      (result[row.phraseKey] ??= {})[row.icd10Code] = row.usageCount;
    }
    return result;
  }

  /**
   * Ghi/tăng số lần dùng cho từng cặp (cụm từ, mã) — upsert ATOMIC qua `INSERT ... ON CONFLICT DO
   * UPDATE` trên partial unique index (Prisma không biểu diễn được `upsert` với unique có điều kiện),
   * cùng khuôn `code-sequence.repository.ts`. `version` tăng 1 mỗi lần cập nhật, đúng CLAUDE.md.
   */
  async recordUsage(
    tx: Prisma.TransactionClient,
    tenantId: string,
    doctorId: string,
    pairs: readonly { phraseKey: string; icd10Code: string }[],
  ): Promise<void> {
    for (const pair of pairs) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "icd10_phrase_usage" ("tenant_id", "doctor_id", "phrase_key", "icd10_code", "created_by", "updated_by")
        VALUES (${tenantId}::uuid, ${doctorId}::uuid, ${pair.phraseKey}, ${pair.icd10Code}, ${doctorId}::uuid, ${doctorId}::uuid)
        ON CONFLICT ("tenant_id", "doctor_id", "phrase_key", "icd10_code") WHERE "deleted_at" IS NULL
        DO UPDATE SET "usage_count" = "icd10_phrase_usage"."usage_count" + 1,
                      "last_used_at" = now(), "updated_at" = now(), "updated_by" = ${doctorId}::uuid,
                      "version" = "icd10_phrase_usage"."version" + 1
      `);
    }
  }
}
