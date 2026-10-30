-- "Số bệnh án" → "Số lưu trữ" (docs/DECISIONS.md #269, đổi tên 30/10/2026): mẫu bệnh án ngoại trú hiện hành MS 15/BV-01 (Thông tư 32/2023/TT-BYT, Phụ lục XXVIII) có ô "Số ngoại trú" và "Số lưu trữ",
-- KHÔNG có ô "Số bệnh án". Chỉ đổi tên cột + chỉ mục; kiểu dữ liệu, ràng buộc duy nhất theo công ty và cách cấp (lúc "Hoàn tất khám") giữ nguyên.
-- Tên trung tính `archive_no` (không gắn "của lượt khám") để sau này gói Sản/Nhi có thể cấp số lưu trữ cho cả đợt theo dõi.
ALTER TABLE "encounter" RENAME COLUMN "record_no" TO "archive_no";
ALTER INDEX "encounter_record_no_uq" RENAME TO "encounter_archive_no_uq";
