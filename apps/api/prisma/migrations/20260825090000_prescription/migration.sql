-- Kê đơn (Sprint 4, S4-01/02/04) — xem .claude/docs/clinical-workflow.md mục "Kê đơn (v1: chỉ in
-- đơn)", docs/ERD.md mục 3.4/2.2, .claude/docs/data-model.md. Viết tay (không `prisma migrate
-- diff`) theo đúng lý do đã ghi ở mọi migration trước có RLS/trigger/partial unique index — công
-- cụ diff không biểu diễn được các đối tượng này.

-- CreateTable — danh mục thuốc THEO TENANT (phòng khám tự nhập, PRD mục 8), khác icd10_catalog/
-- allergen_catalog toàn hệ thống.
CREATE TABLE "drug" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active_ingredient" TEXT,
    "unit" TEXT,
    "concentration" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "drug_pkey" PRIMARY KEY ("id")
);

-- CreateTable — đơn thuốc. signature_payload luôn NULL ở v1 (chữ ký logic qua SignaturePort no-op,
-- xem packages/core/src/ports/signature.port.ts). supersedes_id/amendment_reason cho luồng đính
-- chính (bản mới trỏ về bản cũ đã ký, bản cũ soft-delete) — .claude/docs/clinical-workflow.md mục
-- "Amendment hồ sơ".
CREATE TABLE "prescription" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "signed_at" TIMESTAMPTZ(6),
    "signed_by" UUID,
    "signature_payload" BYTEA,
    "printed_at" TIMESTAMPTZ(6),
    "supersedes_id" UUID,
    "amendment_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable — dòng thuốc. duration_days SMALLINT (đủ cho vài trăm ngày, cùng khuôn vital_sign).
CREATE TABLE "prescription_item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "dose" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "duration_days" SMALLINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "instruction" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "prescription_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drug_tenant_id_id_key" ON "drug"("tenant_id", "id");
CREATE UNIQUE INDEX "drug_tenant_id_code_key" ON "drug"("tenant_id", "code");

-- CreateIndex — tra thuốc theo tên/mã không dấu lúc kê đơn (không cần GIN trigram — quy mô danh
-- mục thuốc 1 phòng khám rất nhỏ so với patient 50k dòng, khác PAT-02).
CREATE INDEX "drug_tenant_id_name_idx" ON "drug" ("tenant_id", "name") WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "prescription_tenant_id_id_key" ON "prescription"("tenant_id", "id");

-- CreateIndex — đúng 1 đơn ĐANG HIỆU LỰC (nháp hoặc đã ký, chưa bị đính chính/xoá) mỗi lượt khám,
-- cùng khuôn C11 (encounter.appointment_id)/C16 (department.is_default).
CREATE UNIQUE INDEX "prescription_tenant_id_encounter_id_active_key"
  ON "prescription" ("tenant_id", "encounter_id")
  WHERE "deleted_at" IS NULL;

-- CreateIndex — tra lịch sử đính chính của một đơn.
CREATE INDEX "prescription_tenant_id_supersedes_id_idx" ON "prescription" ("tenant_id", "supersedes_id") WHERE "supersedes_id" IS NOT NULL;

CREATE UNIQUE INDEX "prescription_item_tenant_id_id_key" ON "prescription_item"("tenant_id", "id");

-- CreateIndex — tra dòng thuốc của một đơn.
CREATE INDEX "prescription_item_tenant_id_prescription_id_idx" ON "prescription_item" ("tenant_id", "prescription_id") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "drug" ADD CONSTRAINT "drug_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "prescription" ADD CONSTRAINT "prescription_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription" ADD CONSTRAINT "prescription_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Self-relation đính chính — cùng khuôn appointment.rescheduled_from_id/patient.merged_into_id, không NOT VALID cần thiết vì bảng mới rỗng.
ALTER TABLE "prescription" ADD CONSTRAINT "prescription_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "prescription"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_tenant_id_prescription_id_fkey" FOREIGN KEY ("tenant_id", "prescription_id") REFERENCES "prescription"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "drug" ADD CONSTRAINT "drug_version_check" CHECK (version >= 1);
ALTER TABLE "prescription" ADD CONSTRAINT "prescription_version_check" CHECK (version >= 1);
ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_version_check" CHECK (version >= 1);

-- C8 (docs/ERD.md mục 4) THẬT LẦN ĐẦU TIÊN trong dự án — `clinical_note` có sẵn 4 cột
-- SignableEntity nhưng chưa từng có trigger này (chưa viết logic ký, luôn NULL). `prescription` là
-- bảng đầu tiên thật sự cưỡng chế "đã ký thì bất biến" ở tầng DB, không chỉ tin tưởng tầng service
-- luôn kiểm đúng. CHỈ chặn sửa đúng phần "nội dung đã ký" (signed_at/signed_by/signature_payload/
-- encounter_id/supersedes_id/amendment_reason không đổi được nữa sau khi ký) — CHO PHÉP printed_at
-- (in đơn sau khi ký, đúng mục đích cột này), deleted_at/deleted_reason (soft-delete khi đính chính
-- — amend() soft-delete bản CŨ đã ký), version/updated_at/updated_by (routine) tiếp tục đổi được.
-- KHÔNG chặn hẳn mọi UPDATE như suy nghĩ đầu tiên — làm vậy sẽ khoá luôn printed_at/soft-delete, cả
-- hai đều là thao tác HỢP LỆ trên một đơn đã ký.
CREATE FUNCTION nexamed_prevent_signed_prescription_update() RETURNS trigger AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
    NEW.encounter_id IS DISTINCT FROM OLD.encounter_id OR
    NEW.signed_at IS DISTINCT FROM OLD.signed_at OR
    NEW.signed_by IS DISTINCT FROM OLD.signed_by OR
    NEW.signature_payload IS DISTINCT FROM OLD.signature_payload OR
    NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id OR
    NEW.amendment_reason IS DISTINCT FROM OLD.amendment_reason
  ) THEN
    RAISE EXCEPTION 'prescription % đã ký lúc %, không thể sửa nội dung đã ký — dùng luồng đính chính (supersedes_id)', OLD.id, OLD.signed_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prescription_prevent_signed_update
  BEFORE UPDATE ON "prescription"
  FOR EACH ROW
  EXECUTE FUNCTION nexamed_prevent_signed_prescription_update();

-- Row Level Security — cùng mẫu mọi migration trước.
ALTER TABLE "drug" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "drug"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "prescription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "prescription"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "prescription_item" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "prescription_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
