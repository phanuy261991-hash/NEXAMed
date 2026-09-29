-- "Gợi ý mã ICD-10 từ ô Chẩn đoán" (docs/DECISIONS.md). Viết tay (không TTY), đúng khuôn mọi migration
-- trước có RLS/partial unique/partial index (công cụ diff không biểu diễn được các đối tượng này).

-- ============ diagnosis — index phục vụ "mã bác sĩ hay dùng" ============
-- Câu truy vấn: đếm số dòng chẩn đoán ĐÃ KÝ của 1 bác sĩ (created_by) theo từng mã ICD, chỉ trên một
-- tập mã ứng viên nhỏ. Partial (signed_at IS NOT NULL AND deleted_at IS NULL) để index gọn — chỉ chứa
-- chẩn đoán đã ký, còn hiệu lực. Chỉ có trong raw SQL (không khai ở schema.prisma) nên lần
-- `prisma migrate dev --create-only` sau phải soát bỏ dòng DROP INDEX này, đúng bài học S2-02.
CREATE INDEX "diagnosis_tenant_id_created_by_icd10_code_signed_idx"
  ON "diagnosis" ("tenant_id", "created_by", "icd10_code")
  WHERE "signed_at" IS NOT NULL AND "deleted_at" IS NULL;

-- ============ icd10_phrase_usage — "học cụm từ → mã" theo từng bác sĩ ============
-- Mỗi dòng = "bác sĩ này, khi gõ cụm (phrase_key) thì đã chọn mã này từ gợi ý N lần". Chỉ ghi khi tenant
-- bật "Học từ lịch sử chọn mã" và lúc "Hoàn tất khám". doctor_id là UUID thuần (không FK tới user_account,
-- đúng khuôn created_by/updated_by ở mọi bảng nghiệp vụ — tài khoản không bao giờ bị xoá cứng).
CREATE TABLE "icd10_phrase_usage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "phrase_key" TEXT NOT NULL,
    "icd10_code" TEXT NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 1,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "icd10_phrase_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "icd10_phrase_usage_tenant_id_id_key" ON "icd10_phrase_usage"("tenant_id", "id");

-- Partial unique — mỗi (bác sĩ, cụm từ, mã) chỉ 1 dòng ĐANG hiệu lực, upsert tăng usage_count (cùng
-- khuôn patient.national_id_hash C3). Đồng thời là index tra "các mã đã học cho cụm này".
CREATE UNIQUE INDEX "icd10_phrase_usage_tenant_doctor_phrase_code_key"
  ON "icd10_phrase_usage" ("tenant_id", "doctor_id", "phrase_key", "icd10_code")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "icd10_phrase_usage" ADD CONSTRAINT "icd10_phrase_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "icd10_phrase_usage" ADD CONSTRAINT "icd10_phrase_usage_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "icd10_phrase_usage" ADD CONSTRAINT "icd10_phrase_usage_version_check" CHECK (version >= 1);
ALTER TABLE "icd10_phrase_usage" ADD CONSTRAINT "icd10_phrase_usage_usage_count_check" CHECK (usage_count >= 1);

ALTER TABLE "icd10_phrase_usage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "icd10_phrase_usage"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
