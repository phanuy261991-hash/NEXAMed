-- Cột "Mô tả" tự do cho reference_catalog — CHỈ có ý nghĩa với category UNIT (Đơn vị tính, chủ dự
-- án yêu cầu trực tiếp 2026-08-26), NULL với category khác (cùng bản chất price/unit).

ALTER TABLE "reference_catalog" ADD COLUMN "description" TEXT;