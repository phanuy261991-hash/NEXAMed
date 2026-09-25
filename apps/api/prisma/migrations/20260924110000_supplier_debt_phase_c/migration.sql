-- "Công nợ nhà cung cấp" — Phần C "Trả hàng NCC" (docs/DECISIONS.md #180/#182, kế hoạch kỹ thuật
-- C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md mục 8). Tiếp nối Phần A/B
-- (20260924100000_supplier_debt_phase_a) — gắn NCC + tiền vào "Phiếu xuất trả NCC"
-- (`stock_issue.issueType='RETURN_TO_SUPPLIER'`, đã có enum từ GĐ4 #170 nhưng chưa gắn NCC/tiền).
--
-- (1) `stock_issue` thêm `supplier_id`/`source_receipt_id` — CHỈ ý nghĩa với RETURN_TO_SUPPLIER,
--     cùng khuôn lỏng `department_id`/INTERNAL_ALLOCATION (CHECK 1 chiều, ép chiều còn lại ở Service
--     — xem 20260923110000_stock_issue_receipt_gd4_extend).
-- (2) `stock_issue_line` thêm `return_unit_price` — CỘT RIÊNG (không tái dùng `sell_price`, tránh
--     lẫn ngữ nghĩa "giá bán → hoá đơn" với "giá trả NCC → công nợ", kế hoạch mục 2.5).
-- (3) `supplier_debt_entry` thêm `stock_issue_id` (nguồn bút toán RETURN) + siết lại CHECK nguồn để
--     bắt buộc RETURN có `stock_issue_id` (đúng khuôn PURCHASE bắt buộc `stock_receipt_id` đã có).

-- ============ stock_issue — gắn NCC + phiếu nhập gốc (tuỳ chọn) cho RETURN_TO_SUPPLIER ============
ALTER TABLE "stock_issue" ADD COLUMN "supplier_id" UUID;
ALTER TABLE "stock_issue" ADD COLUMN "source_receipt_id" UUID;

-- supplier_id/source_receipt_id chỉ có ý nghĩa với RETURN_TO_SUPPLIER — mọi loại khác PHẢI NULL.
-- Bắt buộc NOT NULL cho RETURN_TO_SUPPLIER ép ở tầng Zod/Service (cùng cách department_id).
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_supplier_id_check" CHECK (
  "issue_type" = 'RETURN_TO_SUPPLIER' OR "supplier_id" IS NULL
);
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_source_receipt_id_check" CHECK (
  "issue_type" = 'RETURN_TO_SUPPLIER' OR "source_receipt_id" IS NULL
);

CREATE INDEX "stock_issue_tenant_id_supplier_id_idx" ON "stock_issue"("tenant_id", "supplier_id");

ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_tenant_id_source_receipt_id_fkey" FOREIGN KEY ("tenant_id", "source_receipt_id") REFERENCES "stock_receipt"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============ stock_issue_line — giá trả riêng (chỉ dòng của phiếu RETURN_TO_SUPPLIER có giá trị) ============
ALTER TABLE "stock_issue_line" ADD COLUMN "return_unit_price" BIGINT;
ALTER TABLE "stock_issue_line" ADD CONSTRAINT "stock_issue_line_return_unit_price_check" CHECK (
  "return_unit_price" IS NULL OR "return_unit_price" >= 0
);

-- ============ supplier_debt_entry — nguồn RETURN (mở khoá đường ghi Phần C) ============
ALTER TABLE "supplier_debt_entry" ADD COLUMN "stock_issue_id" UUID;

CREATE INDEX "supplier_debt_entry_tenant_id_stock_issue_id_idx" ON "supplier_debt_entry"("tenant_id", "stock_issue_id");

ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_tenant_id_stock_issue_id_fkey" FOREIGN KEY ("tenant_id", "stock_issue_id") REFERENCES "stock_issue"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Siết lại CHECK nguồn (mở khoá RETURN — bắt buộc stock_issue_id, đúng khuôn PURCHASE bắt buộc
-- stock_receipt_id). ADJUSTMENT_*/REVERSAL vẫn CHƯA siết (Phần D thêm đường ghi + cột adjustment_id).
ALTER TABLE "supplier_debt_entry" DROP CONSTRAINT "supplier_debt_entry_source_check";
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_source_check" CHECK (
  (entry_type = 'PURCHASE' AND stock_receipt_id IS NOT NULL) OR
  (entry_type = 'OPENING_BALANCE' AND stock_receipt_id IS NULL AND cash_voucher_id IS NULL) OR
  (entry_type IN ('PAYMENT', 'REFUND_RECEIVED') AND cash_voucher_id IS NOT NULL) OR
  (entry_type = 'RETURN' AND stock_issue_id IS NOT NULL) OR
  (entry_type IN ('ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE', 'REVERSAL'))
);
