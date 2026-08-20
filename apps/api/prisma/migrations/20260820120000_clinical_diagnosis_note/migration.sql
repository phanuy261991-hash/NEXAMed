-- Khám bệnh (Sprint 3, S3-05→07: SOAP + chọn chẩn đoán ICD-10) — xem
-- .claude/docs/clinical-workflow.md mục "Khám bệnh", docs/ERD.md mục 3.4, .claude/docs/data-model.md.
-- Viết tay (không `prisma migrate diff`) theo đúng lý do đã ghi ở mọi migration trước có RLS/
-- partial unique index (*_appointment_s2_05, *_patient_s2_01, *_encounter_vital_sign_reception):
-- công cụ diff không biểu diễn được các đối tượng này.

-- CreateEnum
CREATE TYPE "diagnosis_type" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "clinical_note_section" AS ENUM ('SUBJECTIVE', 'OBJECTIVE', 'ASSESSMENT', 'PLAN');

-- CreateTable
CREATE TABLE "diagnosis" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "icd10_code" TEXT NOT NULL,
    "type" "diagnosis_type" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable — signed_at/signed_by/supersedes_id/amendment_reason để sẵn theo `SignableEntity`
-- (packages/core), LUÔN NULL ở vòng này — ký hồ sơ (ENC-04) + đính chính là việc của Sprint 5.
CREATE TABLE "clinical_note" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "section" "clinical_note_section" NOT NULL,
    "content" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ(6),
    "signed_by" UUID,
    "supersedes_id" UUID,
    "amendment_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "clinical_note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "diagnosis_tenant_id_id_key" ON "diagnosis"("tenant_id", "id");

-- CreateIndex — tra chẩn đoán của một lượt khám.
CREATE INDEX "diagnosis_tenant_id_encounter_id_idx" ON "diagnosis" ("tenant_id", "encounter_id") WHERE "deleted_at" IS NULL;

-- CreateIndex — C10 (docs/ERD.md mục 4): đúng một chẩn đoán PRIMARY còn hiệu lực mỗi lượt khám,
-- kể cả khi hai request lưu gần như đồng thời (cùng khuôn C2/C3/C11).
CREATE UNIQUE INDEX "diagnosis_tenant_id_encounter_id_primary_key"
  ON "diagnosis" ("tenant_id", "encounter_id")
  WHERE "type" = 'PRIMARY' AND "deleted_at" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "clinical_note_tenant_id_id_key" ON "clinical_note"("tenant_id", "id");

-- CreateIndex — đúng một dòng hiệu lực/section/encounter, cơ sở cho upsert tìm-hoặc-tạo
-- (ClinicalNoteRepository.upsertSection()) — cùng khuôn diagnosis_tenant_id_encounter_id_primary_key.
CREATE UNIQUE INDEX "clinical_note_tenant_id_encounter_id_section_key"
  ON "clinical_note" ("tenant_id", "encounter_id", "section")
  WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "diagnosis" ADD CONSTRAINT "diagnosis_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis" ADD CONSTRAINT "diagnosis_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — icd10_catalog không có tenant_id (danh mục toàn hệ thống), FK thường không composite.
ALTER TABLE "diagnosis" ADD CONSTRAINT "diagnosis_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_note" ADD CONSTRAINT "clinical_note_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_note" ADD CONSTRAINT "clinical_note_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (type IN ('PRIMARY','SECONDARY')) đã ép bằng enum ở tầng cột — không cần CHECK riêng.

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "diagnosis" ADD CONSTRAINT "diagnosis_version_check" CHECK (version >= 1);
ALTER TABLE "clinical_note" ADD CONSTRAINT "clinical_note_version_check" CHECK (version >= 1);

-- Row Level Security — cùng mẫu các migration trước. Quyền SELECT/INSERT/UPDATE cơ bản đã tự
-- động cấp cho nexamed_app qua ALTER DEFAULT PRIVILEGES trong migration *_tenant_context.
ALTER TABLE "diagnosis" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "diagnosis"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "clinical_note" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "clinical_note"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
