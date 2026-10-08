-- Cận lâm sàng GĐ1 (docs/DECISIONS.md #212) — 2 danh mục dùng chung mới. Tách file riêng khỏi migration
-- tạo bảng vì ALTER TYPE ... ADD VALUE không dùng được giá trị mới trong cùng transaction (cùng lý do
-- các migration *_reference_catalog_* trước đây).
ALTER TYPE "reference_catalog_category" ADD VALUE 'TECH_SERVICE_CATEGORY';
ALTER TYPE "reference_catalog_category" ADD VALUE 'SPECIMEN_TYPE';
