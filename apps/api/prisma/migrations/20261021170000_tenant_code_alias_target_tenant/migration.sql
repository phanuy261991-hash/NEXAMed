-- Đổi tên cột `tenant_id` → `target_tenant_id` của bảng `tenant_code_alias` (docs/DECISIONS.md #245).
--
-- Bảng này là bảng NỀN TẢNG (tra theo tên miền TRƯỚC khi biết công ty nào, như `tenant`/`platform_audit_log`), không thuộc dữ liệu của một công ty nên KHÔNG có RLS theo
-- `app.current_tenant_id`. Quy ước của dự án: mọi bảng có cột tên `tenant_id` PHẢI bật RLS (test `rls-coverage` chặn) — bảng nền tảng dùng tên `target_tenant_id`
-- (cột trỏ tới công ty BỊ TÁC ĐỘNG, như `platform_audit_log.target_tenant_id`) và nằm trong danh sách bảng dùng chung đã duyệt. Giữ khoá ngoại tới `tenant(id)`.
ALTER TABLE "tenant_code_alias" RENAME COLUMN "tenant_id" TO "target_tenant_id";
ALTER TABLE "tenant_code_alias" RENAME CONSTRAINT "tenant_code_alias_tenant_fkey" TO "tenant_code_alias_target_tenant_fkey";
ALTER INDEX "tenant_code_alias_tenant_id_idx" RENAME TO "tenant_code_alias_target_tenant_id_idx";
