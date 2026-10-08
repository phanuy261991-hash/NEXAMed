-- Cận lâm sàng GĐ4 — Thực hiện & kết quả (docs/DECISIONS.md #212). `ALTER TYPE ... ADD VALUE` phải ở migration RIÊNG (không dùng được giá trị mới trong cùng transaction).
ALTER TYPE "clinical_order_item_status" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "clinical_order_item_status" ADD VALUE IF NOT EXISTS 'RESULTED';
ALTER TYPE "clinical_order_item_status" ADD VALUE IF NOT EXISTS 'COMPLETED';
