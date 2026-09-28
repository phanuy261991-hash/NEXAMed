-- "Kê thuốc tự do, không qua danh mục" (mở rộng Kho Thuốc GĐ5, đảo ngược 1 điểm của #190) —
-- prescription_item.drug_id đổi nullable, thêm free_text_drug_name, CHECK đúng 1-trong-2. Cùng
-- khuôn "invoice_line_source_exactly_one_check" (migration 20260917110000_pharmacy_dispense_gd3).
-- Composite FK (tenant_id, drug_id) -> drug(tenant_id, id) sẵn có tự bỏ qua khi drug_id NULL
-- (Postgres MATCH SIMPLE mặc định) — không cần sửa.

ALTER TABLE "prescription_item" ALTER COLUMN "drug_id" DROP NOT NULL;
ALTER TABLE "prescription_item" ADD COLUMN "free_text_drug_name" TEXT;

ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_drug_or_free_text_check" CHECK (
  (("drug_id" IS NOT NULL)::int + ("free_text_drug_name" IS NOT NULL)::int) = 1
);
