-- "Thời điểm dùng thuốc" (docs/DECISIONS.md #155) — chủ dự án gửi 2 master data (Cách dùng +
-- Thời điểm dùng), chốt qua phân tích + AskUserQuestion: CHỈ thêm "Thời điểm dùng" (trùng lặp thấp
-- với danh mục có sẵn); "Cách dùng" bỏ hẳn vì ~80% trùng lặp với DRUG_ROUTE/DOSAGE_FORM đã seed
-- (#152). Category mới, không thêm cột nào trên `drug`/`prescription_item` — chỉ dùng làm "gợi ý
-- ghép câu" cho ô text tự do `usage_instruction`/`instruction` đã có sẵn, không đổi cấu trúc lưu
-- trữ. Viết tay, môi trường không có TTY.
ALTER TYPE "reference_catalog_category" ADD VALUE 'DRUG_USAGE_TIMING';
