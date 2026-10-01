-- Khoá lạc quan cho danh mục dùng chung (docs/DECISIONS.md #207): `reference_catalog` trước đây KHÔNG có
-- `version` nên 2 người cùng sửa một mục thì người lưu sau ghi đè người lưu trước mà không báo. Thêm cột
-- `version` (mặc định 1 cho mọi dòng hiện có) — service sửa/ẩn/khôi phục từ nay kèm `WHERE version = ?`
-- và tăng lên 1, đúng quy ước mọi bảng khác. Bảng vẫn toàn hệ thống (không tenant_id) và vẫn không có
-- updated_at/created_by... (xem ngoại lệ trong scripts/check-mandatory-columns.mjs). Viết tay, môi trường không có TTY.
ALTER TABLE "reference_catalog" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "reference_catalog" ADD CONSTRAINT "reference_catalog_version_check" CHECK ("version" >= 1);
