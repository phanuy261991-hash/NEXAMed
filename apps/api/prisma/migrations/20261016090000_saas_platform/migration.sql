-- Đợt 4 SaaS (docs/DECISIONS.md #237): mã công ty/tên miền phụ + tạm ngưng + liên hệ vận hành trên `tenant`, và hai bảng của khu quản trị nền tảng.
-- Forward-only. Không đụng dữ liệu cũ: công ty hiện có giữ `code` NULL (chế độ một công ty không cần mã).

ALTER TABLE "tenant"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "suspended_at" TIMESTAMPTZ(6),
  ADD COLUMN "suspended_reason" TEXT,
  ADD COLUMN "suspended_by" UUID,
  ADD COLUMN "contact_name" TEXT,
  ADD COLUMN "contact_phone" TEXT,
  ADD COLUMN "contact_email" TEXT,
  ADD COLUMN "operator_note" TEXT;

CREATE UNIQUE INDEX "tenant_code_key" ON "tenant"("code");

-- Mã công ty cũng là nhãn DNS: chữ thường/số/gạch ngang, 3-30 ký tự, không bắt đầu/kết thúc bằng gạch ngang.
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_code_format" CHECK ("code" IS NULL OR "code" ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');
-- Đã tạm ngưng thì bắt buộc có lý do.
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_suspended_reason_check" CHECK ("suspended_at" IS NULL OR "suspended_reason" IS NOT NULL);

-- Mã công ty đặt MỘT LẦN, không đổi (tên miền phụ gắn với đường dẫn khách đã lưu và chứng chỉ): chặn ở tầng cơ sở dữ liệu, không chỉ ở ứng dụng.
CREATE FUNCTION nexamed_tenant_code_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."code" IS NOT NULL AND NEW."code" IS DISTINCT FROM OLD."code" THEN
    RAISE EXCEPTION 'Mã công ty đã đặt, không được đổi' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tenant_code_immutable" BEFORE UPDATE OF "code" ON "tenant"
  FOR EACH ROW EXECUTE FUNCTION nexamed_tenant_code_immutable();

-- Người vận hành nền tảng: không thuộc công ty nào (không tenant_id, không RLS — ngoại lệ có chủ đích như `permission`/`icd10_catalog`).
CREATE TABLE "platform_operator" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "username" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "totp_secret_enc" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  "last_failed_login_at" TIMESTAMPTZ(6),
  "locked_until" TIMESTAMPTZ(6),
  "last_login_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "platform_operator_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_operator_version_check" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "platform_operator_username_key" ON "platform_operator"("username");

-- Nhật ký vận hành: append-only (app role không sửa/xoá), không khoá ngoại tới công ty để nhật ký tồn tại độc lập.
CREATE TABLE "platform_audit_log" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "operator_id" UUID,
  "action" TEXT NOT NULL,
  "target_tenant_id" UUID,
  "detail_json" JSONB,
  "ip" TEXT,
  "user_agent" TEXT,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_audit_log_target_tenant_id_occurred_at_idx" ON "platform_audit_log"("target_tenant_id", "occurred_at" DESC);
CREATE INDEX "platform_audit_log_occurred_at_idx" ON "platform_audit_log"("occurred_at" DESC);

REVOKE UPDATE ON "platform_audit_log" FROM nexamed_app;
