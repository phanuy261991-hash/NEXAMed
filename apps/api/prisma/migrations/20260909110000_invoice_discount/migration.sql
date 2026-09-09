-- Chiết khấu trên phiếu thu (chốt qua AskUserQuestion trước khi code, không phải "Price Book" —
-- chỉ 2 cách loại trừ lẫn nhau: "Toàn hoá đơn" (invoice.discount_type/discount_value) HOẶC "Từng
-- dịch vụ" (invoice_line.discount_type/discount_value). Loại trừ lẫn nhau ép ở tầng service/
-- repository (InvoiceRepository.applyDiscount()), KHÔNG bằng CHECK/trigger DB — 1 phiếu có thể có
-- 0 dòng chiết khấu (không dùng tính năng) nên không có ràng buộc chéo bảng đơn giản nào diễn tả
-- đúng "invoice có discount XOR bất kỳ line nào có discount" mà không cần trigger.
--
-- Số tiền chiết khấu thật (discountAmount) KHÔNG lưu cột riêng — tính bằng computeInvoiceDiscount()
-- (@nexamed/core) từ 2 cột này + total_amount/line_total, đúng tinh thần "không lưu derived field"
-- (như needsRefund()). Viết tay (không `prisma migrate dev`, môi trường không có TTY).

CREATE TYPE "invoice_discount_type" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterTable — invoice.
ALTER TABLE "invoice" ADD COLUMN "discount_type" "invoice_discount_type";
ALTER TABLE "invoice" ADD COLUMN "discount_value" BIGINT;
ALTER TABLE "invoice" ADD COLUMN "discount_reason" TEXT;

-- discount_value nguyên không âm; PERCENT thì <= 100 (AMOUNT không có trần ở DB — trần thật là
-- total_amount, kiểm ở tầng service vì cần đọc total_amount cùng lúc).
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_discount_value_check" CHECK (
  "discount_value" IS NULL
  OR ("discount_value" >= 0 AND ("discount_type" <> 'PERCENT' OR "discount_value" <= 100))
);

-- AlterTable — invoice_line (chiết khấu "Từng dịch vụ", 1 dòng có thể không chiết khấu dù invoice
-- đang ở chế độ PER_LINE — discount_type NULL nghĩa là dòng đó giữ nguyên giá).
ALTER TABLE "invoice_line" ADD COLUMN "discount_type" "invoice_discount_type";
ALTER TABLE "invoice_line" ADD COLUMN "discount_value" BIGINT;

ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_discount_value_check" CHECK (
  "discount_value" IS NULL
  OR ("discount_value" >= 0 AND ("discount_type" <> 'PERCENT' OR "discount_value" <= 100))
);
