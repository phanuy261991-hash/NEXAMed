-- 11 từ viết tắt mặc định của "Gợi ý mã ICD-10" (danh sách nháp chủ dự án đã duyệt 2026-09-29, #200),
-- giữ NGUYÊN hành vi cũ khi chuyển từ danh sách tĩnh trong code sang bảng. `code` = từ viết tắt viết
-- thường (khớp NGUYÊN TỪ, cả "đtđ" lẫn "dtd" đều có mục riêng), `name` = cách viết đầy đủ. Chỉ đổi chữ
-- thành chữ — mã ICD vẫn luôn lấy từ `icd10_catalog` (danh mục BYT), không map thẳng ra mã. Seed MỘT
-- LẦN lúc migrate (không đồng bộ lại mỗi lần db:seed) nên clinic_admin sửa/ẩn mục nào cũng không bị ghi đè.
INSERT INTO "reference_catalog" (category, code, name, sort_order, is_active)
VALUES
  ('ICD10_ABBREVIATION', 'tha', 'tăng huyết áp', 0, true),
  ('ICD10_ABBREVIATION', 'đtđ', 'đái tháo đường', 1, true),
  ('ICD10_ABBREVIATION', 'dtd', 'đái tháo đường', 2, true),
  ('ICD10_ABBREVIATION', 'type', 'típ', 3, true),
  ('ICD10_ABBREVIATION', 'tip', 'típ', 4, true),
  ('ICD10_ABBREVIATION', 'sxh', 'sốt xuất huyết', 5, true),
  ('ICD10_ABBREVIATION', 'vpq', 'viêm phế quản', 6, true),
  ('ICD10_ABBREVIATION', 'rlth', 'rối loạn tiêu hóa', 7, true),
  ('ICD10_ABBREVIATION', 'nktn', 'nhiễm trùng tiết niệu', 8, true),
  ('ICD10_ABBREVIATION', 'gerd', 'trào ngược dạ dày thực quản', 9, true),
  ('ICD10_ABBREVIATION', 'cảm', 'viêm mũi họng cấp tính', 10, true);
