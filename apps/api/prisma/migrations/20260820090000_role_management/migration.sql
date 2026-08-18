-- ADM-07 — vai trò tuỳ biến: clinic_admin tạo/đổi tên/ẩn vai trò ngoài 5 vai trò mặc định
-- (`is_system_default=true`). UNIQUE(tenant_id, name) trên `role` (từ migration
-- `20260808015619_rbac_data_scope`) đổi từ thường sang PARTIAL (WHERE deleted_at IS NULL) — cùng
-- lý do C3 (patient.national_id_hash) và user_role (migration
-- *_user_role_partial_unique_s2_07): unique thường sẽ chặn tạo lại đúng tên vai trò đã từng bị
-- ẩn (soft-delete) trước đó. Prisma không hỗ trợ `@@unique` có điều kiện `WHERE` — bỏ khai báo
-- trong schema.prisma, viết thẳng SQL.

DROP INDEX "role_tenant_id_name_key";

CREATE UNIQUE INDEX "role_tenant_id_name_key"
  ON "role" ("tenant_id", "name")
  WHERE "deleted_at" IS NULL;