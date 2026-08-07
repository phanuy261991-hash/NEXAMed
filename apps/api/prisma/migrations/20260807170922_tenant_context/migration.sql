-- S1-03 — Tenant context: role riêng cho app, CHECK(version >= 1), Row Level Security.
-- Xem .claude/docs/multi-tenancy.md (ràng buộc 1-2), docs/ERD.md mục 4 (C1, C6, C9),
-- docs/DECISIONS.md #008/#010.
--
-- Migration này chạy bằng role đặc quyền (MIGRATE_DATABASE_URL trong .env), KHÔNG phải
-- role app (nexamed_app) — role app phải KHÔNG có quyền tạo role/ALTER TABLE.

-- 1) Role riêng cho ứng dụng: không superuser, không BYPASSRLS, không tạo được role/DB khác.
--    Mật khẩu ở đây chỉ dùng cho local dev/CI. Khi triển khai on-prem (S4-05) phải đổi bằng
--    ALTER ROLE ngoài version control, không dựa vào giá trị trong migration này.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexamed_app') THEN
    CREATE ROLE nexamed_app WITH LOGIN PASSWORD 'nexamed_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE nexamed TO nexamed_app;
GRANT USAGE ON SCHEMA public TO nexamed_app;

-- Quyền cho bảng đã có: đọc/ghi nhưng không xoá cứng (xem .claude/docs/data-model.md).
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO nexamed_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM nexamed_app;

-- audit_log: append-only, không cho UPDATE (chỉ INSERT + SELECT).
REVOKE UPDATE ON audit_log FROM nexamed_app;

-- Quyền mặc định cho bảng tạo sau này bởi cùng role chạy migration (nexamed) — không phải
-- lặp lại GRANT thủ công ở mỗi migration mới.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO nexamed_app;

-- 2) CHECK (version >= 1) — optimistic locking, xem .claude/docs/data-model.md.
ALTER TABLE tenant ADD CONSTRAINT tenant_version_check CHECK (version >= 1);
ALTER TABLE tenant_setting ADD CONSTRAINT tenant_setting_version_check CHECK (version >= 1);
ALTER TABLE room ADD CONSTRAINT room_version_check CHECK (version >= 1);
ALTER TABLE user_account ADD CONSTRAINT user_account_version_check CHECK (version >= 1);
ALTER TABLE user_role ADD CONSTRAINT user_role_version_check CHECK (version >= 1);
ALTER TABLE code_sequence ADD CONSTRAINT code_sequence_version_check CHECK (version >= 1);

-- 3) Row Level Security — mọi bảng có cột tenant_id (không áp cho `tenant`: bảng đó chính là
--    gốc của tenant, không có cột tenant_id để so sánh — xem docs/DECISIONS.md #011).
--    missing_ok = true ở current_setting: phiên chưa set context thì trả 0 dòng thay vì lỗi
--    SQL, khớp triết lý "fail closed, ẩn thay vì lộ lỗi" đã dùng cho lỗi 404 xuyên tenant.
ALTER TABLE tenant_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE room ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_setting
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON room
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON user_account
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON user_role
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON code_sequence
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);