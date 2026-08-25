-- Tiền sử bản thân/gia đình có cấu trúc (Sprint 5) — thay khối chip/ma trận cho phần "Tiền sử"
-- trong màn Thêm/Sửa bệnh nhân + Tiếp nhận. `patient.personal_history` GIỮ NGUYÊN làm ghi chú bổ
-- sung tự do; `patient.family_history` GIỮ NGUYÊN trong DB nhưng ngừng đọc/ghi từ UI mới (không có
-- tenant production nào có dữ liệu thật, không cần migration dọn dẹp).

-- CreateEnum
CREATE TYPE "family_relation" AS ENUM ('FATHER', 'MOTHER', 'SIBLING', 'PATERNAL_GRANDPARENT', 'MATERNAL_GRANDPARENT');

-- CreateTable — bệnh lý nền + thói quen/lối sống (thói quen mã hoá bằng ICD-10 Chương XXI Z72.x,
-- KHÔNG tách bảng/cột riêng).
CREATE TABLE "patient_condition" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "icd10_code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "patient_condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable — ma trận Quan hệ huyết thống x Bệnh lý (ICD-10) + tuổi phát hiện. KHÔNG unique trên
-- (patient, relation, icd10Code) — nhiều người thân cùng quan hệ có thể cùng mắc 1 bệnh.
CREATE TABLE "patient_family_history" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "relation" "family_relation" NOT NULL,
    "icd10_code" TEXT NOT NULL,
    "age_of_onset_years" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "patient_family_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_condition_tenant_id_id_key" ON "patient_condition"("tenant_id", "id");

-- CreateIndex — gỡ rồi gán lại đúng bệnh lý đã từng gỡ không vi phạm unique, cùng khuôn C3/C14/C18.
CREATE UNIQUE INDEX "patient_condition_tenant_id_patient_id_icd10_code_key"
  ON "patient_condition" ("tenant_id", "patient_id", "icd10_code")
  WHERE "deleted_at" IS NULL;

-- CreateIndex — tra danh sách bệnh lý nền của một bệnh nhân.
CREATE INDEX "patient_condition_tenant_id_patient_id_idx" ON "patient_condition" ("tenant_id", "patient_id") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "patient_family_history_tenant_id_id_key" ON "patient_family_history"("tenant_id", "id");

-- CreateIndex — tra danh sách tiền sử gia đình của một bệnh nhân.
CREATE INDEX "patient_family_history_tenant_id_patient_id_idx" ON "patient_family_history" ("tenant_id", "patient_id") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "patient_condition" ADD CONSTRAINT "patient_condition_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_condition" ADD CONSTRAINT "patient_condition_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- icd10_catalog không có tenant_id (danh mục toàn hệ thống), FK thường không composite — cùng khuôn diagnosis.icd10_code.
ALTER TABLE "patient_condition" ADD CONSTRAINT "patient_condition_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_family_history" ADD CONSTRAINT "patient_family_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_family_history" ADD CONSTRAINT "patient_family_history_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_family_history" ADD CONSTRAINT "patient_family_history_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "patient_condition" ADD CONSTRAINT "patient_condition_version_check" CHECK (version >= 1);
ALTER TABLE "patient_family_history" ADD CONSTRAINT "patient_family_history_version_check" CHECK (version >= 1);

-- Row Level Security — cùng mẫu mọi migration trước.
ALTER TABLE "patient_condition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "patient_condition"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "patient_family_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "patient_family_history"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
