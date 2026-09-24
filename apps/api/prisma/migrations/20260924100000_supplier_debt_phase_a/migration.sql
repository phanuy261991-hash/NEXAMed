-- "Công nợ nhà cung cấp" — Phần A "Nền sổ công nợ" (docs/DECISIONS.md #180/#182, kế hoạch kỹ thuật
-- C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md). Viết tay (không `prisma
-- migrate diff` — role migrate không có quyền tạo shadow database trên máy dev), đúng khuôn
-- 20260909100000_patient_wallet (8 cột bắt buộc + RLS + composite FK + CHECK version).
--
-- (1) `supplier_debt_account` (1 dòng/NCC, `balance` snapshot) + `supplier_debt_entry` (sổ ghi
--     append-only — PURCHASE/PAYMENT/OPENING_BALANCE dùng ở Phần A; RETURN/REFUND_RECEIVED/
--     ADJUSTMENT_*/REVERSAL khai enum sẵn cho Phần B/C/D, chưa có đường ghi). Cột `adjustment_id`
--     (trỏ `supplier_debt_adjustment`) CHƯA thêm — bảng đó để dành Phần D, thêm bằng migration
--     riêng khi đó (đúng khuôn additive nhiều migration khác trong dự án).
-- (2) `stock_receipt` thêm 4 cột "Trả ngay" (chỉ ý nghĩa receiptType='PURCHASE', ép ở tầng Service).
-- (3) `cash_voucher` thêm `supplier_id` (phiếu "Trả ngay lúc nhập"/"Thanh toán công nợ"/"NCC hoàn
--     tiền" gắn NCC).
-- (4) Seed 2 mã `INCOME_EXPENSE_TYPE` hệ thống (`direction=NULL` — ẩn khỏi form lập Phiếu thu/chi
--     TAY, đúng kỹ thuật đã dùng cho PATIENT_ADVANCE).

-- CreateEnum
CREATE TYPE "supplier_debt_entry_type" AS ENUM ('OPENING_BALANCE', 'PURCHASE', 'PAYMENT', 'RETURN', 'REFUND_RECEIVED', 'ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE', 'REVERSAL');

-- CreateTable
CREATE TABLE "supplier_debt_account" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "supplier_debt_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_debt_account_tenant_id_id_key" ON "supplier_debt_account"("tenant_id", "id");

-- CreateIndex — 1 sổ công nợ/NCC.
CREATE UNIQUE INDEX "supplier_debt_account_tenant_id_supplier_id_key" ON "supplier_debt_account"("tenant_id", "supplier_id");

-- AddForeignKey
ALTER TABLE "supplier_debt_account" ADD CONSTRAINT "supplier_debt_account_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, supplier_id): chống trỏ chéo tenant.
ALTER TABLE "supplier_debt_account" ADD CONSTRAINT "supplier_debt_account_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "supplier_debt_account" ADD CONSTRAINT "supplier_debt_account_version_check" CHECK (version >= 1);

ALTER TABLE "supplier_debt_account" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "supplier_debt_account"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- CreateTable
CREATE TABLE "supplier_debt_entry" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "entry_type" "supplier_debt_entry_type" NOT NULL,
    "amount_change" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "stock_receipt_id" UUID,
    "cash_voucher_id" UUID,
    "reversal_of_id" UUID,
    "note" TEXT,

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "supplier_debt_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_debt_entry_tenant_id_id_key" ON "supplier_debt_entry"("tenant_id", "id");

-- CreateIndex — liệt kê Sổ công nợ theo NCC, đúng thứ tự ghi sổ (tab "Sổ công nợ").
CREATE INDEX "supplier_debt_entry_tenant_id_account_id_created_at_idx" ON "supplier_debt_entry"("tenant_id", "account_id", "created_at");

-- CreateIndex — tra cứu bút toán PURCHASE/PAYMENT theo phiếu nhập (tab "Phiếu nhập", allocateSupplierDebt()).
CREATE INDEX "supplier_debt_entry_tenant_id_stock_receipt_id_idx" ON "supplier_debt_entry"("tenant_id", "stock_receipt_id");

-- CreateIndex — tra cứu bút toán theo phiếu quỹ (hook CashVoucherService.approve()/voidVoucher()).
CREATE INDEX "supplier_debt_entry_tenant_id_cash_voucher_id_idx" ON "supplier_debt_entry"("tenant_id", "cash_voucher_id");

-- CreateIndex — 1 bút toán chỉ đảo được 1 lần (mục 2.2 kế hoạch).
CREATE UNIQUE INDEX "supplier_debt_entry_tenant_id_reversal_of_id_key" ON "supplier_debt_entry"("tenant_id", "reversal_of_id") WHERE "reversal_of_id" IS NOT NULL;

ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_amount_change_check" CHECK (amount_change <> 0);

-- Ràng buộc nguồn theo entry_type — chỉ khoá chặt 3 loại Phần A THẬT SỰ ghi (PURCHASE/OPENING_BALANCE/
-- PAYMENT+REFUND_RECEIVED); RETURN/ADJUSTMENT_*/REVERSAL chưa có đường ghi nên chưa ràng buộc, siết
-- lại bằng migration riêng khi Phần C/D thêm đường ghi tương ứng.
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_source_check" CHECK (
  (entry_type = 'PURCHASE' AND stock_receipt_id IS NOT NULL) OR
  (entry_type = 'OPENING_BALANCE' AND stock_receipt_id IS NULL AND cash_voucher_id IS NULL) OR
  (entry_type IN ('PAYMENT', 'REFUND_RECEIVED') AND cash_voucher_id IS NOT NULL) OR
  (entry_type IN ('RETURN', 'ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE', 'REVERSAL'))
);

-- AddForeignKey
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, account_id): chống trỏ chéo tenant.
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_tenant_id_account_id_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "supplier_debt_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, stock_receipt_id), NULLABLE.
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_tenant_id_stock_receipt_id_fkey" FOREIGN KEY ("tenant_id", "stock_receipt_id") REFERENCES "stock_receipt"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, cash_voucher_id), NULLABLE.
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_tenant_id_cash_voucher_id_fkey" FOREIGN KEY ("tenant_id", "cash_voucher_id") REFERENCES "cash_voucher"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — tự tham chiếu composite (tenant_id, reversal_of_id), NULLABLE.
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_tenant_id_reversal_of_id_fkey" FOREIGN KEY ("tenant_id", "reversal_of_id") REFERENCES "supplier_debt_entry"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1)
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_version_check" CHECK (version >= 1);

ALTER TABLE "supplier_debt_entry" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "supplier_debt_entry"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- AlterTable — "Trả ngay" trên `stock_receipt` (chỉ ý nghĩa receiptType='PURCHASE', ép ở Service).
ALTER TABLE "stock_receipt" ADD COLUMN "prepaid_amount" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "stock_receipt" ADD COLUMN "prepaid_payment_method_code" TEXT;
ALTER TABLE "stock_receipt" ADD COLUMN "prepaid_cash_account_id" UUID;
ALTER TABLE "stock_receipt" ADD COLUMN "prepaid_voucher_id" UUID;

ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_prepaid_amount_check" CHECK (prepaid_amount >= 0);

-- AddForeignKey — composite (tenant_id, prepaid_cash_account_id), NULLABLE.
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_tenant_id_prepaid_cash_account_id_fkey" FOREIGN KEY ("tenant_id", "prepaid_cash_account_id") REFERENCES "cash_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, prepaid_voucher_id), NULLABLE.
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_tenant_id_prepaid_voucher_id_fkey" FOREIGN KEY ("tenant_id", "prepaid_voucher_id") REFERENCES "cash_voucher"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable — `cash_voucher` gắn NCC (Trả ngay/Thanh toán công nợ/NCC hoàn tiền).
ALTER TABLE "cash_voucher" ADD COLUMN "supplier_id" UUID;

-- CreateIndex — lọc "Phiếu thanh toán NCC" theo NCC (Phần B).
CREATE INDEX "cash_voucher_tenant_id_supplier_id_idx" ON "cash_voucher"("tenant_id", "supplier_id");

-- AddForeignKey — composite (tenant_id, supplier_id), NULLABLE.
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed 2 mã hệ thống INCOME_EXPENSE_TYPE (direction=NULL — ẩn khỏi form lập Phiếu thu/chi TAY,
-- đúng kỹ thuật đã dùng cho PATIENT_ADVANCE ở 20260909100000_patient_wallet). Dùng cho CẢ "Trả
-- ngay lúc nhập" (mã PC, Phần A) lẫn "Thanh toán công nợ" (mã TTNCC, Phần B).
INSERT INTO "reference_catalog" (category, code, name, sort_order, is_active)
VALUES ('INCOME_EXPENSE_TYPE', 'SUPPLIER_DEBT_PAYMENT', 'Thanh toán công nợ nhà cung cấp', 0, true);

INSERT INTO "reference_catalog" (category, code, name, sort_order, is_active)
VALUES ('INCOME_EXPENSE_TYPE', 'SUPPLIER_REFUND', 'Nhà cung cấp hoàn tiền', 0, true);
