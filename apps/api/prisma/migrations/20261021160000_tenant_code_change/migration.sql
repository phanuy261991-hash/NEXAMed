-- Quy trình đổi MÃ công ty (tên miền phụ) có kiểm soát (chủ dự án chốt 21/10/2026, docs/DECISIONS.md #245).
--
-- Trước đây mã đặt MỘT lần và bị khoá cứng ở DB. Thực tế khách sẽ có lúc cần đổi (đổi thương hiệu, gõ sai lúc tạo), nên mở một đường có kiểm soát — chỉ người vận hành nền tảng làm được,
-- bắt buộc lý do, ghi nhật ký, giữ mã cũ làm lối tắt chuyển hướng 90 ngày, không cấp lại mã cũ cho công ty khác trong thời gian đó, và thu hồi mọi phiên đăng nhập của công ty.

-- 1) Lối tắt: mã cũ → công ty. Bảng nền tảng (như `tenant`, không RLS vì được tra theo tên miền TRƯỚC khi biết công ty nào). Chỉ thêm, không sửa/xoá: lịch sử đổi mã giữ nguyên.
CREATE TABLE "tenant_code_alias" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "old_code" TEXT NOT NULL,
  "new_code" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "tenant_code_alias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_code_alias_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id"),
  CONSTRAINT "tenant_code_alias_old_code_format" CHECK ("old_code" ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  CONSTRAINT "tenant_code_alias_new_code_format" CHECK ("new_code" ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  CONSTRAINT "tenant_code_alias_version_check" CHECK ("version" >= 1)
);
CREATE INDEX "tenant_code_alias_old_code_expires_at_idx" ON "tenant_code_alias"("old_code", "expires_at" DESC);
CREATE INDEX "tenant_code_alias_tenant_id_idx" ON "tenant_code_alias"("tenant_id");
REVOKE UPDATE ON "tenant_code_alias" FROM nexamed_app;

-- 2) Trigger bất biến: vẫn CHẶN mọi lệnh UPDATE đổi mã ngoài quy trình (kể cả sửa tay qua psql, như đã chặn đúng lúc dựng thử SaaS 21/10/2026). Chỉ cho đổi khi giao dịch bật cờ
-- cục bộ `app.allow_tenant_code_change = 'on'` — cờ này chỉ do `PlatformTenantService.changeCode` đặt (SET LOCAL, hết hiệu lực khi giao dịch kết thúc). Vẫn không cho đổi mã thành rỗng.
CREATE OR REPLACE FUNCTION nexamed_tenant_code_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."code" IS NOT NULL AND NEW."code" IS DISTINCT FROM OLD."code" THEN
    IF NEW."code" IS NULL OR current_setting('app.allow_tenant_code_change', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Mã công ty đã đặt, không được đổi' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
