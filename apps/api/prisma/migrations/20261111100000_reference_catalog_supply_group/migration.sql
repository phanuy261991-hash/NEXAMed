-- "Phân nhóm VTYT" (docs/DECISIONS.md #297, hoàn thiện quản lý Vật tư y tế) — danh mục MỞ cho vật tư y tế (Vật tư tiêu hao,
-- Vật tư thay thế, Dụng cụ phẫu thuật...), dùng lại cột `drug.drug_group_code` (không thêm cột). Không dùng được ngay trong
-- cùng giao dịch với ADD VALUE nên 3 giá trị khởi tạo do seed (`seed-reference-catalog.ts`) nạp, không phải migration này.
ALTER TYPE "reference_catalog_category" ADD VALUE 'SUPPLY_GROUP';
