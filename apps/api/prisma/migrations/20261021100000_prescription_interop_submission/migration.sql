-- Liên thông đơn thuốc quốc gia, GĐ3 (docs/DECISIONS.md #242): thông tin bổ sung bắt buộc khi gửi đơn (mockup 8b) + hàng chờ gửi đơn (mockup 8c).
--
-- encounter_interop_kind_info: khoá theo (lượt khám, loại đơn C/N/H/Y) — KHÔNG theo prescription_document vì đính chính soft-delete đơn pháp lý rồi tạo lại,
--   trong khi các ô này phải còn nguyên qua đính chính. Không thuộc nội dung đơn đã ký nên sửa được tới khi đơn được gửi (có nhật ký).
--   Chi nhánh: kế thừa qua lượt khám (encounter.branch_id).
-- prescription_submission (outbox): một dòng cho mỗi đơn pháp lý cần gửi (mã đơn duy nhất). Theo chi nhánh: branch_id NOT NULL (composite FK), lấy từ lượt khám lúc xếp hàng.
--   KHÔNG lưu gói dữ liệu bệnh nhân (dựng lại lúc gửi từ dữ liệu hiện tại, vì các ô 8b còn sửa được). errors = nguyên văn danh_sach_cac_loi của cổng.
-- Forward-only.

CREATE TABLE "encounter_interop_kind_info" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "encounter_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "treatment_form_code" TEXT,
  "dose_period_number" INTEGER,
  "dose_from" DATE,
  "dose_to" DATE,
  "herbal_doses" INTEGER,
  "herbal_instruction" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "encounter_interop_kind_info_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "encounter_interop_kind_info_version_check" CHECK ("version" >= 1),
  CONSTRAINT "encounter_interop_kind_info_kind_check" CHECK ("kind" IN ('C', 'N', 'H', 'Y')),
  CONSTRAINT "encounter_interop_kind_info_treatment_form_check" CHECK ("treatment_form_code" IS NULL OR "treatment_form_code" ~ '^[0-9]{1,9}$'),
  CONSTRAINT "encounter_interop_kind_info_dose_period_check" CHECK ("dose_period_number" IS NULL OR "dose_period_number" BETWEEN 1 AND 999),
  CONSTRAINT "encounter_interop_kind_info_dose_range_check" CHECK ("dose_from" IS NULL OR "dose_to" IS NULL OR "dose_to" >= "dose_from"),
  CONSTRAINT "encounter_interop_kind_info_herbal_doses_check" CHECK ("herbal_doses" IS NULL OR "herbal_doses" BETWEEN 1 AND 999),
  CONSTRAINT "encounter_interop_kind_info_herbal_instruction_check" CHECK ("herbal_instruction" IS NULL OR length("herbal_instruction") <= 1000),
  CONSTRAINT "encounter_interop_kind_info_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "encounter_interop_kind_info_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "encounter_interop_kind_info_tenant_id_id_key" ON "encounter_interop_kind_info"("tenant_id", "id");
CREATE UNIQUE INDEX "encounter_interop_kind_info_kind_active_key" ON "encounter_interop_kind_info"("tenant_id", "encounter_id", "kind") WHERE "deleted_at" IS NULL;

ALTER TABLE "encounter_interop_kind_info" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "encounter_interop_kind_info" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "encounter_interop_kind_info"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE "prescription_submission" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "encounter_id" UUID NOT NULL,
  "prescription_document_id" UUID NOT NULL,
  "national_code" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "doctor_user_id" UUID NOT NULL,
  "signed_at" TIMESTAMPTZ(6) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMPTZ(6),
  "next_attempt_at" TIMESTAMPTZ(6),
  "locked_until" TIMESTAMPTZ(6),
  "last_http_status" INTEGER,
  "errors" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "sent_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "prescription_submission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prescription_submission_version_check" CHECK ("version" >= 1),
  CONSTRAINT "prescription_submission_kind_check" CHECK ("kind" IN ('C', 'N', 'H', 'Y')),
  CONSTRAINT "prescription_submission_status_check" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'AMENDED')),
  CONSTRAINT "prescription_submission_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "prescription_submission_sent_check" CHECK (("status" IN ('SENT', 'AMENDED')) = ("sent_at" IS NOT NULL)),
  CONSTRAINT "prescription_submission_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "prescription_submission_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "prescription_submission_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "prescription_submission_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "prescription_document_id") REFERENCES "prescription_document"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "prescription_submission_tenant_id_doctor_user_id_fkey" FOREIGN KEY ("tenant_id", "doctor_user_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "prescription_submission_tenant_id_id_key" ON "prescription_submission"("tenant_id", "id");
-- Mã đơn là khoá tra cứu trên cổng nên mỗi mã chỉ một dòng hàng chờ đang hiệu lực.
CREATE UNIQUE INDEX "prescription_submission_code_active_key" ON "prescription_submission"("tenant_id", "national_code") WHERE "deleted_at" IS NULL;
CREATE INDEX "prescription_submission_due_idx" ON "prescription_submission"("tenant_id", "status", "next_attempt_at") WHERE "deleted_at" IS NULL;
CREATE INDEX "prescription_submission_branch_signed_idx" ON "prescription_submission"("tenant_id", "branch_id", "signed_at") WHERE "deleted_at" IS NULL;
CREATE INDEX "prescription_submission_encounter_idx" ON "prescription_submission"("tenant_id", "encounter_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "prescription_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prescription_submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "prescription_submission"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
