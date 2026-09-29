-- "Cấu trúc liều dùng theo buổi Sáng/Trưa/Chiều/Tối" (mockup đã duyệt, docs/DECISIONS.md #196) — thay
-- hẳn 2 cột tự do `dose`/`frequency` của `prescription_item`/`prescription_template_item` bằng 4 cột
-- số nguyên theo buổi trong ngày. `quantity` từ nay LUÔN do backend tính =
-- (dose_morning+dose_noon+dose_afternoon+dose_evening) × duration_days, không còn nhận trực tiếp từ
-- client. Đơn vị tính LUÔN là đơn vị nhỏ nhất của thuốc (`drug.base_unit_code`) — resolve qua JOIN
-- lúc đọc, KHÔNG lưu/snapshot cột riêng ở đây.
--
-- Dữ liệu `dose`/`frequency` cũ của đơn ĐÃ KÝ (bất biến theo CLAUDE.md) KHÔNG bị xoá mất — gộp vào
-- cột `instruction` sẵn có TRƯỚC khi xoá 2 cột cũ, giữ đúng nội dung lâm sàng đã kê cho việc xem
-- lại/in lại sau này (đổi HÌNH THỨC lưu trữ, không đổi NỘI DUNG đã ký). `quantity` của dòng cũ GIỮ
-- NGUYÊN — KHÔNG tính lại theo công thức mới (sẽ sai vì 4 cột buổi mặc định 0 cho dữ liệu cũ, trong
-- khi số lượng thật đã chốt từ trước vẫn đúng và có thể đã được dùng để trừ kho/tính tiền ở GĐ3).

-- ============ prescription_item ============
ALTER TABLE "prescription_item" ADD COLUMN "dose_morning" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "prescription_item" ADD COLUMN "dose_noon" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "prescription_item" ADD COLUMN "dose_afternoon" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "prescription_item" ADD COLUMN "dose_evening" SMALLINT NOT NULL DEFAULT 0;

UPDATE "prescription_item"
SET "instruction" = CASE
  WHEN "instruction" IS NULL OR "instruction" = '' THEN 'Liều dùng cũ: ' || COALESCE("dose", '') || ', ' || COALESCE("frequency", '')
  ELSE "instruction" || ' — Liều dùng cũ: ' || COALESCE("dose", '') || ', ' || COALESCE("frequency", '')
END
WHERE COALESCE("dose", '') != '' OR COALESCE("frequency", '') != '';

ALTER TABLE "prescription_item" DROP COLUMN "dose";
ALTER TABLE "prescription_item" DROP COLUMN "frequency";

-- ============ prescription_template_item ============
ALTER TABLE "prescription_template_item" ADD COLUMN "dose_morning" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "prescription_template_item" ADD COLUMN "dose_noon" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "prescription_template_item" ADD COLUMN "dose_afternoon" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "prescription_template_item" ADD COLUMN "dose_evening" SMALLINT NOT NULL DEFAULT 0;

UPDATE "prescription_template_item"
SET "instruction" = CASE
  WHEN "instruction" IS NULL OR "instruction" = '' THEN 'Liều dùng cũ: ' || COALESCE("dose", '') || ', ' || COALESCE("frequency", '')
  ELSE "instruction" || ' — Liều dùng cũ: ' || COALESCE("dose", '') || ', ' || COALESCE("frequency", '')
END
WHERE COALESCE("dose", '') != '' OR COALESCE("frequency", '') != '';

ALTER TABLE "prescription_template_item" DROP COLUMN "dose";
ALTER TABLE "prescription_template_item" DROP COLUMN "frequency";
