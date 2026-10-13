-- FORCE ROW LEVEL SECURITY cho MỌI bảng có cột `tenant_id` (rà soát 13/10/2026, docs/DECISIONS.md #229 cảnh báo C → #230).
--
-- Trước đây chỉ `ENABLE ROW LEVEL SECURITY`: chủ sở hữu bảng (owner) vẫn BỎ QUA policy. Ứng dụng chạy bằng role `nexamed_app`
-- (không phải owner, không BYPASSRLS) nên không ảnh hưởng — nhưng nếu một ngày đổi role/cấp quyền nhầm cho owner, cô lập tenant
-- sẽ vỡ im lặng. FORCE khiến policy áp dụng cả với owner. Superuser/BYPASSRLS (role migrate/seed) vẫn bỏ qua như cũ nên
-- migration và seed không bị chặn.
--
-- Idempotent: chỉ đụng bảng đã bật RLS mà chưa FORCE. Forward-only.
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
      AND EXISTS (
        SELECT 1 FROM information_schema.columns k
        WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl.relname);
  END LOOP;
END
$$;
