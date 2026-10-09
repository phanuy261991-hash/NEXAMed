-- Điều trị & Hẹn tái khám (docs/DECISIONS.md #222). 2 bảng mới THEO TENANT, viết tay, đúng khuôn các migration trước: 8 cột bắt buộc, RLS, CHECK(version>=1).

-- ---------------------------------------------------------------------------------------------
-- encounter_treatment_plan — Hướng điều trị + ngày hẹn tái khám của MỘT lượt khám (bản ký, đúng khuôn clinical_note/prescription)
-- ---------------------------------------------------------------------------------------------
CREATE TYPE "treatment_direction" AS ENUM ('PRESCRIPTION', 'TRANSFER', 'FOLLOW_UP', 'EMERGENCY');

CREATE TABLE "encounter_treatment_plan" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "directions" "treatment_direction"[] NOT NULL DEFAULT ARRAY[]::"treatment_direction"[],
    "follow_up_date" DATE,
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

    CONSTRAINT "encounter_treatment_plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "encounter_treatment_plan_tenant_id_id_key" ON "encounter_treatment_plan"("tenant_id", "id");
-- Đúng 1 bản ĐANG hiệu lực mỗi lượt khám (bản đính chính thay thế bản cũ đã soft-delete).
CREATE UNIQUE INDEX "encounter_treatment_plan_encounter_key" ON "encounter_treatment_plan" ("tenant_id", "encounter_id") WHERE "deleted_at" IS NULL;
-- Tra "ai hẹn tái khám ngày nào" (nhắc lịch về sau).
CREATE INDEX "encounter_treatment_plan_follow_up_idx" ON "encounter_treatment_plan" ("tenant_id", "follow_up_date") WHERE "deleted_at" IS NULL AND "follow_up_date" IS NOT NULL;
CREATE INDEX "encounter_treatment_plan_supersedes_idx" ON "encounter_treatment_plan" ("tenant_id", "supersedes_id") WHERE "supersedes_id" IS NOT NULL;

ALTER TABLE "encounter_treatment_plan" ADD CONSTRAINT "encounter_treatment_plan_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "encounter_treatment_plan" ADD CONSTRAINT "encounter_treatment_plan_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "encounter_treatment_plan" ADD CONSTRAINT "encounter_treatment_plan_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "encounter_treatment_plan"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "encounter_treatment_plan" ADD CONSTRAINT "encounter_treatment_plan_version_check" CHECK (version >= 1);
-- Có hướng "Hẹn tái khám" ⇔ có ngày hẹn (hai chiều): bỏ tích thì ngày hẹn không được lưu, tích thì bắt buộc có ngày.
ALTER TABLE "encounter_treatment_plan" ADD CONSTRAINT "encounter_treatment_plan_follow_up_check" CHECK (("follow_up_date" IS NOT NULL) = ('FOLLOW_UP' = ANY("directions")));
-- Đã ký thì phải có người ký.
ALTER TABLE "encounter_treatment_plan" ADD CONSTRAINT "encounter_treatment_plan_signed_check" CHECK (("signed_at" IS NULL) = ("signed_by" IS NULL));
-- Bản đính chính bắt buộc kèm lý do (Thông tư 46/2018/TT-BYT), bản gốc thì không có.
ALTER TABLE "encounter_treatment_plan" ADD CONSTRAINT "encounter_treatment_plan_amendment_check" CHECK (
  ("supersedes_id" IS NULL AND "amendment_reason" IS NULL)
  OR ("supersedes_id" IS NOT NULL AND "amendment_reason" IS NOT NULL AND btrim("amendment_reason") <> '')
);

ALTER TABLE "encounter_treatment_plan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "encounter_treatment_plan"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Bất biến sau khi ký (CLAUDE.md "Bản ghi đã ký là bất biến"; cùng khuôn nexamed_prevent_signed_clinical_note_update).
-- Chỉ chặn sửa NỘI DUNG đã ký; cho phép soft-delete (khi đính chính), version/updated_*.
CREATE FUNCTION nexamed_prevent_signed_treatment_plan_update() RETURNS trigger AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
    NEW.encounter_id IS DISTINCT FROM OLD.encounter_id OR
    NEW.directions IS DISTINCT FROM OLD.directions OR
    NEW.follow_up_date IS DISTINCT FROM OLD.follow_up_date OR
    NEW.signed_at IS DISTINCT FROM OLD.signed_at OR
    NEW.signed_by IS DISTINCT FROM OLD.signed_by OR
    NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id OR
    NEW.amendment_reason IS DISTINCT FROM OLD.amendment_reason
  ) THEN
    RAISE EXCEPTION 'encounter_treatment_plan % đã ký lúc %, không thể sửa nội dung đã ký — dùng luồng đính chính (supersedes_id)', OLD.id, OLD.signed_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER encounter_treatment_plan_prevent_signed_update
  BEFORE UPDATE ON "encounter_treatment_plan"
  FOR EACH ROW
  EXECUTE FUNCTION nexamed_prevent_signed_treatment_plan_update();

-- ---------------------------------------------------------------------------------------------
-- advice_template — Mẫu lời dặn dùng chung toàn phòng khám (đúng khuôn prescription_template)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "advice_template" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "advice_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "advice_template_tenant_id_id_key" ON "advice_template"("tenant_id", "id");
-- Tên mẫu không trùng (không phân biệt hoa thường) trong cùng phòng khám.
CREATE UNIQUE INDEX "advice_template_name_key" ON "advice_template" ("tenant_id", lower(btrim("name"))) WHERE "deleted_at" IS NULL;

ALTER TABLE "advice_template" ADD CONSTRAINT "advice_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "advice_template" ADD CONSTRAINT "advice_template_version_check" CHECK (version >= 1);
ALTER TABLE "advice_template" ADD CONSTRAINT "advice_template_content_check" CHECK (btrim("name") <> '' AND btrim("content") <> '');

ALTER TABLE "advice_template" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "advice_template"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
