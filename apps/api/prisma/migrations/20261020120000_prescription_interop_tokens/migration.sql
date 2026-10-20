-- Liên thông đơn thuốc quốc gia, GIAI ĐOẠN 3 (docs/DECISIONS.md #242): token đăng nhập cổng + trạng thái "đã thêm bác sĩ vào cơ sở trên cổng".
--
-- Token (bearer, hiệu lực 7 ngày, cổng KHÔNG trả hạn nên lưu giờ nhận để tự tính hạn) mã hoá AES-256-GCM, không bao giờ trả về qua API.
-- 1) interop_facility_credential.token_enc/token_issued_at — token CƠ SỞ (dùng để thêm/xoá bác sĩ). Theo chi nhánh (bảng đã có branch_id).
-- 2) interop_doctor_facility — theo CẶP (bác sĩ, chi nhánh/cơ sở): đã thêm bác sĩ vào cơ sở trên cổng chưa + token BÁC SĨ của cặp đó (bác sĩ làm hai chi nhánh có hai token).
--    branch_id NOT NULL (composite FK); user_id composite FK. Forward-only.

ALTER TABLE "interop_facility_credential" ADD COLUMN "token_enc" BYTEA;
ALTER TABLE "interop_facility_credential" ADD COLUMN "token_issued_at" TIMESTAMPTZ(6);
ALTER TABLE "interop_facility_credential" ADD CONSTRAINT "interop_facility_credential_token_check"
  CHECK (("token_enc" IS NULL) = ("token_issued_at" IS NULL));

CREATE TABLE "interop_doctor_facility" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "added_at" TIMESTAMPTZ(6),
  "token_enc" BYTEA,
  "token_issued_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "interop_doctor_facility_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interop_doctor_facility_version_check" CHECK ("version" >= 1),
  CONSTRAINT "interop_doctor_facility_token_check" CHECK (("token_enc" IS NULL) = ("token_issued_at" IS NULL)),
  CONSTRAINT "interop_doctor_facility_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "interop_doctor_facility_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "interop_doctor_facility_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "interop_doctor_facility_tenant_id_id_key" ON "interop_doctor_facility"("tenant_id", "id");
CREATE UNIQUE INDEX "interop_doctor_facility_pair_active_key" ON "interop_doctor_facility"("tenant_id", "user_id", "branch_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "interop_doctor_facility_tenant_id_branch_id_idx" ON "interop_doctor_facility"("tenant_id", "branch_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "interop_doctor_facility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interop_doctor_facility" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "interop_doctor_facility"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
