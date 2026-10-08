-- Cận lâm sàng GĐ2 (docs/DECISIONS.md #212) — danh mục dùng chung "Đơn vị kết quả xét nghiệm". Tách file riêng vì ALTER TYPE ... ADD VALUE
-- không dùng được giá trị mới trong cùng transaction (cùng lý do các migration *_reference_catalog_* trước). Dữ liệu seed qua db:seed.
ALTER TYPE "reference_catalog_category" ADD VALUE 'LAB_RESULT_UNIT';
