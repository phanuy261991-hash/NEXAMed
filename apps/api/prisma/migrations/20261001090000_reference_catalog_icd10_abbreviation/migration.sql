-- Từ điển viết tắt chẩn đoán cho "Gợi ý mã ICD-10" (docs/DECISIONS.md #206) — trước đây là danh sách
-- tĩnh 11 mục trong packages/core, nay chuyển sang `reference_catalog` để clinic_admin tự thêm/sửa/ẩn
-- qua UI. Chỉ thêm giá trị enum; seed 11 mục mặc định ở migration kế tiếp (Postgres không cho dùng
-- giá trị enum vừa ADD VALUE trong cùng transaction). Viết tay, môi trường không có TTY.
ALTER TYPE "reference_catalog_category" ADD VALUE 'ICD10_ABBREVIATION';
