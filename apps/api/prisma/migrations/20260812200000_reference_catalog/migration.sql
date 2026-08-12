-- Danh mục dùng chung "reference_catalog" (Dân tộc, Quốc tịch) — đảo ngược docs/DECISIONS.md
-- #034 phần ethnicity/nationality (occupation vẫn text tự do, không đổi). Danh mục toàn hệ
-- thống (giống permission/icd10_catalog): không tenant_id, không đủ 8 cột bắt buộc, không
-- version. Viết tay (không có TTY để chạy `prisma migrate dev`), cùng cách các migration
-- trước trên bảng danh mục toàn hệ thống.
--
-- Khác migration RBAC (permission bị REVOKE INSERT/UPDATE vì chỉ seed script đặc quyền được
-- ghi): bảng này quản lý được qua chính API bởi clinic_admin (reference_catalog.manage) nên
-- KHÔNG revoke gì — giữ nguyên GRANT SELECT/INSERT/UPDATE mặc định của nexamed_app (đã cấp qua
-- ALTER DEFAULT PRIVILEGES ở migration *_tenant_context). DELETE đã bị revoke toàn cục cho
-- nexamed_app từ migration đó rồi (áp dụng cho mọi bảng, kể cả bảng tạo sau) — không cần thêm
-- REVOKE DELETE ở đây. "Xoá" trong UI quản lý là is_active=false (soft), không phải DELETE thật.

CREATE TYPE "reference_catalog_category" AS ENUM ('ETHNICITY', 'NATIONALITY');

CREATE TABLE "reference_catalog" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "category" "reference_catalog_category" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "reference_catalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reference_catalog_category_code_key" ON "reference_catalog"("category", "code");
