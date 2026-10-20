-- Liên thông đơn thuốc quốc gia, GIAI ĐOẠN 3 (docs/DECISIONS.md #242): mã + mật khẩu đăng nhập cổng của CƠ SỞ (theo chi nhánh) và của BÁC SĨ (chung cả công ty).
--
-- Bảng riêng (không thêm cột vào branch/user_account) để mật khẩu mã hoá không bị đọc nhầm qua các truy vấn rộng của hai bảng đó.
-- Mật khẩu: AES-256-GCM (cùng cơ chế mã hoá CCCD), cột bytea, KHÔNG trả về qua API.
-- Chi nhánh: interop_facility_credential.branch_id NOT NULL (composite FK); interop_doctor_credential KHÔNG theo chi nhánh (một tài khoản cổng/bác sĩ). Forward-only.

CREATE TABLE "interop_facility_credential" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "password_enc" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "interop_facility_credential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interop_facility_credential_version_check" CHECK ("version" >= 1),
  CONSTRAINT "interop_facility_credential_code_check" CHECK (length(btrim("code")) BETWEEN 1 AND 100),
  CONSTRAINT "interop_facility_credential_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "interop_facility_credential_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "interop_facility_credential_tenant_id_id_key" ON "interop_facility_credential"("tenant_id", "id");
CREATE UNIQUE INDEX "interop_facility_credential_branch_active_key" ON "interop_facility_credential"("tenant_id", "branch_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "interop_facility_credential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interop_facility_credential" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "interop_facility_credential"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE "interop_doctor_credential" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "password_enc" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "interop_doctor_credential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interop_doctor_credential_version_check" CHECK ("version" >= 1),
  CONSTRAINT "interop_doctor_credential_code_check" CHECK (length(btrim("code")) BETWEEN 1 AND 100),
  CONSTRAINT "interop_doctor_credential_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "interop_doctor_credential_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "interop_doctor_credential_tenant_id_id_key" ON "interop_doctor_credential"("tenant_id", "id");
CREATE UNIQUE INDEX "interop_doctor_credential_user_active_key" ON "interop_doctor_credential"("tenant_id", "user_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "interop_doctor_credential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interop_doctor_credential" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "interop_doctor_credential"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
