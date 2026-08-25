-- Dị nguyên đã biết của bệnh nhân (Sprint 4, chốt 2026-08-25) — liên kết `patient` với danh mục
-- "Dị nguyên" có sẵn (`allergen_catalog`, migration 20260821180000_allergen_catalog) thay vì chỉ
-- đọc `patient.allergy_note` tự do, phục vụ PRE-03 chính xác hơn. Bảng NỐI có đủ 8 cột bắt buộc
-- (dữ liệu nghiệp vụ chạm bệnh nhân, không phải danh mục hệ thống) — `patient.allergy_note` KHÔNG
-- đổi/xoá, vẫn là ghi chú bổ sung tự do.

-- CreateTable
CREATE TABLE "patient_allergen" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "allergen_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "patient_allergen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_allergen_tenant_id_id_key" ON "patient_allergen"("tenant_id", "id");

-- CreateIndex — gỡ rồi gán lại đúng dị nguyên đã từng gỡ không vi phạm unique, cùng khuôn C3
-- (patient.national_id_hash)/C14 (role.name).
CREATE UNIQUE INDEX "patient_allergen_tenant_id_patient_id_allergen_id_key"
  ON "patient_allergen" ("tenant_id", "patient_id", "allergen_id")
  WHERE "deleted_at" IS NULL;

-- CreateIndex — tra danh sách dị nguyên của một bệnh nhân (đọc lúc khám/kê đơn).
CREATE INDEX "patient_allergen_tenant_id_patient_id_idx" ON "patient_allergen" ("tenant_id", "patient_id") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "patient_allergen" ADD CONSTRAINT "patient_allergen_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_allergen" ADD CONSTRAINT "patient_allergen_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- allergen không có tenant_id (danh mục toàn hệ thống), FK thường không composite — cùng khuôn diagnosis.icd10_code -> icd10_catalog.code.
ALTER TABLE "patient_allergen" ADD CONSTRAINT "patient_allergen_allergen_id_fkey" FOREIGN KEY ("allergen_id") REFERENCES "allergen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "patient_allergen" ADD CONSTRAINT "patient_allergen_version_check" CHECK (version >= 1);

-- Row Level Security — cùng mẫu mọi migration trước.
ALTER TABLE "patient_allergen" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "patient_allergen"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
