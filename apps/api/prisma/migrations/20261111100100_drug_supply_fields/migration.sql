-- Hoàn thiện quản lý Vật tư y tế (docs/DECISIONS.md #297): "Tính chất sử dụng" (chỉ là nhãn phân loại, KHÔNG đổi cách tính giá) và cờ
-- "Chỉ dùng nội bộ, không bán" dùng chung cho Thuốc và Vật tư (bật thì không bắt nhập giá bán, ẩn khỏi bán/phát/kê đơn).
-- Viết tay, môi trường không có TTY. Cột mới nullable/mặc định false nên dữ liệu đang chạy ở pilot không đổi hành vi.
CREATE TYPE "drug_supply_usage_nature" AS ENUM ('SINGLE_USE', 'REUSABLE');
ALTER TABLE "drug" ADD COLUMN "supply_usage_nature" "drug_supply_usage_nature";
ALTER TABLE "drug" ADD COLUMN "internal_use_only" BOOLEAN NOT NULL DEFAULT false;
