-- Danh mục hành chính Tỉnh/Phường-Xã toàn hệ thống (theo sáp nhập hành chính 2025, mã Bộ Nội vụ)
-- — docs/DECISIONS.md #038. Cùng bản chất icd10_catalog/permission: không tenant_id, không đủ 8
-- cột bắt buộc, không version/is_active. Viết tay (không có TTY để chạy `prisma migrate dev`),
-- cùng cách các migration trước trên bảng danh mục toàn hệ thống.
--
-- Khác reference_catalog: bảng này READ-ONLY lúc chạy — dữ liệu hành chính chính thức, không ai
-- cần sửa qua UI (chưa có endpoint create/update/delete). Vì vậy REVOKE INSERT/UPDATE khỏi
-- nexamed_app (giống migration RBAC đã làm cho `permission`) — chỉ seed script (chạy bằng
-- MIGRATE_DATABASE_URL, role đặc quyền) ghi được. DELETE chưa từng được GRANT cho bảng mới qua
-- ALTER DEFAULT PRIVILEGES (chỉ SELECT/INSERT/UPDATE, xem migration *_tenant_context) nên không
-- cần REVOKE DELETE riêng.
--
-- `code` phường/xã (8 chữ số) duy nhất toàn quốc — đã xác nhận không trùng giữa các tỉnh lúc soạn
-- seed — nên dùng thẳng làm PRIMARY KEY, không cần composite (province_code, code).

CREATE TABLE "province" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "province_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "ward" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "province_code" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ward_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "ward_province_code_idx" ON "ward"("province_code");

ALTER TABLE "ward" ADD CONSTRAINT "ward_province_code_fkey"
    FOREIGN KEY ("province_code") REFERENCES "province"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

REVOKE INSERT, UPDATE ON "province", "ward" FROM nexamed_app;
