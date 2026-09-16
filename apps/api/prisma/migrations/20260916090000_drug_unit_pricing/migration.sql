-- "Giá bán theo từng đơn vị cụ thể" (mở rộng Giai đoạn 1 Kho Thuốc & Vật tư y tế, chủ dự án yêu
-- cầu trực tiếp, docs/DECISIONS.md #150) — viết tay, môi trường không có TTY (cùng cách
-- 20260915140000_pharmacy_catalog_gd1).
--
-- Công tắc THEO TỪNG MẶT HÀNG: mặc định false, giữ nguyên hành vi hiện tại (giá mỗi bậc quy đổi
-- suy ra từ drug.default_sell_price theo tỷ lệ). Bật thì mỗi bậc trong drug_unit có giá riêng.
ALTER TABLE "drug" ADD COLUMN "unit_pricing_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "drug_unit" ADD COLUMN "sell_price" BIGINT;
