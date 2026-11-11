-- Ngày sản xuất của lô (docs/DECISIONS.md #297, giai đoạn 2). Cột mới đều nullable nên dữ liệu đang chạy ở pilot không đổi hành vi.
-- Viết tay, môi trường không có TTY.
ALTER TABLE "stock_receipt_line" ADD COLUMN "manufacture_date" DATE;
ALTER TABLE "inventory_batch" ADD COLUMN "manufacture_date" DATE;
ALTER TABLE "stock_count_line" ADD COLUMN "new_batch_manufacture_date" DATE;

-- Ngày sản xuất phải trước hạn dùng khi có đủ cả hai (kiểm cả ở Zod + Service, đây là chốt chặn cuối ở CSDL).
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_manufacture_before_expiry_chk"
  CHECK ("manufacture_date" IS NULL OR "expiry_date" IS NULL OR "manufacture_date" < "expiry_date");
ALTER TABLE "inventory_batch" ADD CONSTRAINT "inventory_batch_manufacture_before_expiry_chk"
  CHECK ("manufacture_date" IS NULL OR "expiry_date" IS NULL OR "manufacture_date" < "expiry_date");
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_new_batch_manufacture_before_expiry_chk"
  CHECK ("new_batch_manufacture_date" IS NULL OR "new_batch_expiry_date" IS NULL OR "new_batch_manufacture_date" < "new_batch_expiry_date");
