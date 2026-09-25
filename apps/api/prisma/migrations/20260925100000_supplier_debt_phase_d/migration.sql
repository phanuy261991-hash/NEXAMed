-- "Công nợ nhà cung cấp" — Phần D "Luồng xử lý sai sót" (docs/DECISIONS.md #180/#182, kế hoạch kỹ
-- thuật C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md mục 4 +
-- clever-dazzling-bentley.md). Viết tay, đúng khuôn Phần A/C (8 cột bắt buộc + RLS + composite FK +
-- CHECK version).
--
-- (1) Bảng mới `supplier_debt_adjustment` — "Phiếu điều chỉnh công nợ" (INCREASE/DECREASE, Tầng 3)
--     + "Đề nghị huỷ" (VOID_REQUEST, Tầng 2 — người không có quyền duyệt phiếu gốc).
-- (2) `supplier_debt_entry` thêm `adjustment_id` (nguồn ADJUSTMENT_INCREASE/ADJUSTMENT_DECREASE) +
--     siết lại CHECK nguồn lần 3 để bắt buộc 2 loại này có `adjustment_id`. REVERSAL vẫn KHÔNG siết
--     (tự tương quan qua stock_receipt_id/stock_issue_id trùng target_*_id của adjustment gốc).

-- ============ supplier_debt_adjustment ============
CREATE TYPE "supplier_debt_adjustment_kind" AS ENUM ('INCREASE', 'DECREASE', 'VOID_REQUEST');
CREATE TYPE "supplier_debt_adjustment_status" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

CREATE TABLE "supplier_debt_adjustment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "adjustment_no" TEXT NOT NULL,
    "kind" "supplier_debt_adjustment_kind" NOT NULL,
    "amount" BIGINT,
    "target_receipt_id" UUID,
    "target_issue_id" UUID,
    "target_voucher_id" UUID,
    "reason" TEXT NOT NULL,
    "evidence_ref" TEXT,
    "status" "supplier_debt_adjustment_status" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "supplier_debt_adjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_debt_adjustment_tenant_id_id_key" ON "supplier_debt_adjustment"("tenant_id", "id");

-- Tra cứu theo NCC (tab "Nhật ký điều chỉnh") + trạng thái (badge/danh sách chờ duyệt).
CREATE INDEX "supplier_debt_adjustment_tenant_id_supplier_id_idx" ON "supplier_debt_adjustment"("tenant_id", "supplier_id");
CREATE INDEX "supplier_debt_adjustment_tenant_id_status_idx" ON "supplier_debt_adjustment"("tenant_id", "status");
-- Liên kết ngược trên chính phiếu nhập/xuất gốc (badge "Có điều chỉnh" ở StockReceiptFormPage/StockIssueFormPage).
CREATE INDEX "supplier_debt_adjustment_tenant_id_target_receipt_id_idx" ON "supplier_debt_adjustment"("tenant_id", "target_receipt_id");
CREATE INDEX "supplier_debt_adjustment_tenant_id_target_issue_id_idx" ON "supplier_debt_adjustment"("tenant_id", "target_issue_id");

ALTER TABLE "supplier_debt_adjustment" ADD CONSTRAINT "supplier_debt_adjustment_amount_check" CHECK (
  (kind IN ('INCREASE', 'DECREASE') AND amount IS NOT NULL AND amount > 0) OR
  (kind = 'VOID_REQUEST' AND amount IS NULL)
);

-- VOID_REQUEST bắt buộc đúng 1 trong 2 target (receipt/issue), không có target_voucher_id.
-- INCREASE/DECREASE: cả 3 target đều TUỲ CHỌN (tham khảo, không ràng buộc số lượng).
ALTER TABLE "supplier_debt_adjustment" ADD CONSTRAINT "supplier_debt_adjustment_target_check" CHECK (
  (kind = 'VOID_REQUEST' AND target_voucher_id IS NULL AND (
    (target_receipt_id IS NOT NULL AND target_issue_id IS NULL) OR
    (target_receipt_id IS NULL AND target_issue_id IS NOT NULL)
  )) OR
  (kind IN ('INCREASE', 'DECREASE'))
);

ALTER TABLE "supplier_debt_adjustment" ADD CONSTRAINT "supplier_debt_adjustment_rejection_reason_check" CHECK (
  (status = 'REJECTED' AND rejection_reason IS NOT NULL) OR (status != 'REJECTED' AND rejection_reason IS NULL)
);

ALTER TABLE "supplier_debt_adjustment" ADD CONSTRAINT "supplier_debt_adjustment_approved_check" CHECK (
  (status = 'APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR
  (status != 'APPROVED' AND approved_by IS NULL AND approved_at IS NULL)
);

ALTER TABLE "supplier_debt_adjustment" ADD CONSTRAINT "supplier_debt_adjustment_version_check" CHECK (version >= 1);

ALTER TABLE "supplier_debt_adjustment" ADD CONSTRAINT "supplier_debt_adjustment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_debt_adjustment" ADD CONSTRAINT "supplier_debt_adjustment_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_debt_adjustment" ADD CONSTRAINT "supplier_debt_adjustment_tenant_id_target_receipt_id_fkey" FOREIGN KEY ("tenant_id", "target_receipt_id") REFERENCES "stock_receipt"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_debt_adjustment" ADD CONSTRAINT "supplier_debt_adjustment_tenant_id_target_issue_id_fkey" FOREIGN KEY ("tenant_id", "target_issue_id") REFERENCES "stock_issue"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_debt_adjustment" ADD CONSTRAINT "supplier_debt_adjustment_tenant_id_target_voucher_id_fkey" FOREIGN KEY ("tenant_id", "target_voucher_id") REFERENCES "cash_voucher"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_debt_adjustment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "supplier_debt_adjustment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ supplier_debt_entry — nguồn ADJUSTMENT_INCREASE/ADJUSTMENT_DECREASE ============
ALTER TABLE "supplier_debt_entry" ADD COLUMN "adjustment_id" UUID;

CREATE INDEX "supplier_debt_entry_tenant_id_adjustment_id_idx" ON "supplier_debt_entry"("tenant_id", "adjustment_id");

ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_tenant_id_adjustment_id_fkey" FOREIGN KEY ("tenant_id", "adjustment_id") REFERENCES "supplier_debt_adjustment"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Siết lại CHECK nguồn lần 3 — mở khoá ADJUSTMENT_INCREASE/ADJUSTMENT_DECREASE (bắt buộc
-- adjustment_id, đúng khuôn PURCHASE bắt buộc stock_receipt_id). REVERSAL vẫn KHÔNG siết (kế thừa
-- nguồn từ bút toán gốc qua reversal_of_id — kể cả REVERSAL sinh từ "Huỷ chứng từ"/"Đề nghị huỷ",
-- tự tương quan qua stock_receipt_id/stock_issue_id, không cần adjustment_id).
ALTER TABLE "supplier_debt_entry" DROP CONSTRAINT "supplier_debt_entry_source_check";
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_source_check" CHECK (
  (entry_type = 'PURCHASE' AND stock_receipt_id IS NOT NULL) OR
  (entry_type = 'OPENING_BALANCE' AND stock_receipt_id IS NULL AND cash_voucher_id IS NULL) OR
  (entry_type IN ('PAYMENT', 'REFUND_RECEIVED') AND cash_voucher_id IS NOT NULL) OR
  (entry_type = 'RETURN' AND stock_issue_id IS NOT NULL) OR
  (entry_type IN ('ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE') AND adjustment_id IS NOT NULL) OR
  (entry_type = 'REVERSAL')
);
