-- Danh mục ICD-10 toàn hệ thống (S3-01, mở khoá một phần — chỉ Chương I trước, xem
-- docs/DECISIONS.md). Cùng bản chất province/ward/permission: không tenant_id, không đủ 8 cột
-- bắt buộc, không version. Viết tay (không có TTY để chạy `prisma migrate dev`), cùng cách các
-- migration trước trên bảng danh mục toàn hệ thống.
--
-- Read-only lúc chạy — danh mục Bộ Y tế, không ai cần sửa qua UI (chưa có endpoint
-- create/update/delete). Vì vậy REVOKE INSERT/UPDATE khỏi nexamed_app (giống province/ward/
-- permission) — chỉ seed script (chạy bằng MIGRATE_DATABASE_URL, role đặc quyền) ghi được.
-- DELETE chưa từng được GRANT cho bảng mới qua ALTER DEFAULT PRIVILEGES nên không cần REVOKE
-- DELETE riêng.

CREATE TYPE "icd10_gender_restriction" AS ENUM ('male', 'female');
CREATE TYPE "icd10_usage_restriction" AS ENUM ('limited_primary', 'not_primary');

CREATE TABLE "icd10_catalog" (
    "code" TEXT NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT,
    "chapter_code" TEXT NOT NULL,
    "chapter_name" TEXT NOT NULL,
    "block_code" TEXT NOT NULL,
    "block_name" TEXT NOT NULL,
    "group_code" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "is_billable" BOOLEAN NOT NULL DEFAULT true,
    "gender_restriction" "icd10_gender_restriction",
    "usage_restriction" "icd10_usage_restriction",
    "who_note" TEXT,

    CONSTRAINT "icd10_catalog_pkey" PRIMARY KEY ("code")
);

-- search_key: tái dùng nguyên hàm nexamed_unaccent_lower() đã tạo ở migration
-- 20260811055006_patient_search_s2_02 (S2-02, PAT-02) — KHÔNG định nghĩa lại. Hàm này đã
-- IMMUTABLE PARALLEL SAFE, dùng được thẳng trong generated column ở bảng bất kỳ, không chỉ patient.
ALTER TABLE "icd10_catalog"
  ADD COLUMN "search_key" TEXT GENERATED ALWAYS AS (nexamed_unaccent_lower(name_vi)) STORED;

-- Không tenant_id nên GIN thuần trên search_key, không cần kết hợp btree_gin như patient
-- (extension unaccent/pg_trgm đã bật từ migration patient_search_s2_02, không cần bật lại).
CREATE INDEX "icd10_catalog_search_key_trgm_idx"
  ON "icd10_catalog" USING GIN ("search_key" gin_trgm_ops);

CREATE INDEX "icd10_catalog_chapter_code_idx" ON "icd10_catalog"("chapter_code");
CREATE INDEX "icd10_catalog_group_code_idx" ON "icd10_catalog"("group_code");

REVOKE INSERT, UPDATE ON "icd10_catalog" FROM nexamed_app;