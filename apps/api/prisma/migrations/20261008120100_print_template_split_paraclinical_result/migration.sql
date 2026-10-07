-- Chuyển bản mẫu in "Kết quả cận lâm sàng" (PARACLINICAL_RESULT) đã lưu sang 2 chứng từ mới (docs/DECISIONS.md #215): phòng khám nào đã chỉnh mẫu cũ thì giữ nguyên
-- cấu hình đó cho CẢ "Kết quả xét nghiệm" (đổi loại tại chỗ) và "Kết quả CĐHA & Thăm dò chức năng" (nhân bản), không mất tuỳ chỉnh. Giá trị enum cũ vẫn nằm trong kiểu
-- (Postgres không gỡ được) nhưng không còn dòng nào dùng.
INSERT INTO "print_template" ("tenant_id", "document_type", "paper_size", "name", "is_default", "config_json", "created_by", "updated_by")
SELECT "tenant_id", 'IMAGING_RESULT', "paper_size", replace("name", 'Kết quả cận lâm sàng', 'Kết quả CĐHA & Thăm dò chức năng'), "is_default", "config_json", "created_by", "updated_by"
FROM "print_template"
WHERE "document_type" = 'PARACLINICAL_RESULT' AND "deleted_at" IS NULL;

UPDATE "print_template"
SET "document_type" = 'LAB_RESULT',
    "name" = replace("name", 'Kết quả cận lâm sàng', 'Kết quả xét nghiệm'),
    "updated_at" = CURRENT_TIMESTAMP,
    "version" = "version" + 1
WHERE "document_type" = 'PARACLINICAL_RESULT' AND "deleted_at" IS NULL;
