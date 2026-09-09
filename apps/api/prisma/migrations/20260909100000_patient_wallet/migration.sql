-- "Ví tạm ứng" (Patient Advance-Payment Wallet) — bệnh nhân nộp tiền trước, hệ thống tự cấn trừ
-- khi phát sinh phiếu thu lúc tiếp nhận. Viết tay (không `prisma migrate diff`), đúng khuôn
-- 20260905130000_cash_book (8 cột bắt buộc + RLS + composite FK + CHECK version).
--
-- (1) Bảng `patient_wallet` (1 ví/bệnh nhân) + `wallet_transaction` (sổ ghi append-only mọi biến
--     động số dư — nạp/cấn trừ/hoàn/tất toán). Nạp/tất toán tái dùng `cash_voucher` sẵn có (tiền
--     THẬT vào/ra két) — `wallet_transaction.cash_voucher_id` trỏ về đúng phiếu quỹ đã sinh; cấn
--     trừ/hoàn ví không đụng két (tiền đã vào từ lúc nạp) — `wallet_transaction.invoice_id` trỏ về
--     đúng phiếu thu liên quan.
-- (2) Seed 2 danh mục toàn hệ thống (reference_catalog KHÔNG có tenant_id — dùng chung mọi tenant,
--     cùng cách CASH/BANK_TRANSFER đã seed ở 20260827121000_seed_payment_method_catalog):
--     PAYMENT_METHOD 'WALLET' (counts_as_cash=false — trừ ví KHÔNG phải tiền mặt vào két, tránh
--     tính trùng ở đối soát Chốt ca) và INCOME_EXPENSE_TYPE 'PATIENT_ADVANCE' (dùng cho cả phiếu
--     Thu lúc nạp lẫn phiếu Chi lúc tất toán — reference_catalog.direction chỉ mang tính phân loại
--     hiển thị, KHÔNG bị Service đối chiếu với direction thật của từng cash_voucher, nên để NULL).

-- CreateEnum
CREATE TYPE "patient_wallet_status" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "patient_wallet" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "status" "patient_wallet_status" NOT NULL DEFAULT 'ACTIVE',
    "closed_at" TIMESTAMPTZ(6),

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "patient_wallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_wallet_tenant_id_id_key" ON "patient_wallet"("tenant_id", "id");

-- CreateIndex — 1 ví/bệnh nhân.
CREATE UNIQUE INDEX "patient_wallet_tenant_id_patient_id_key" ON "patient_wallet"("tenant_id", "patient_id");

-- AddForeignKey
ALTER TABLE "patient_wallet" ADD CONSTRAINT "patient_wallet_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, patient_id): chống trỏ chéo tenant.
ALTER TABLE "patient_wallet" ADD CONSTRAINT "patient_wallet_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "patient_wallet" ADD CONSTRAINT "patient_wallet_version_check" CHECK (version >= 1);

ALTER TABLE "patient_wallet" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "patient_wallet"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- CreateEnum
CREATE TYPE "wallet_transaction_type" AS ENUM ('TOPUP', 'DEDUCT', 'REFUND', 'SETTLEMENT');

-- CreateTable
CREATE TABLE "wallet_transaction" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "type" "wallet_transaction_type" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "invoice_id" UUID,
    "cash_voucher_id" UUID,
    "note" TEXT,

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "wallet_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transaction_tenant_id_id_key" ON "wallet_transaction"("tenant_id", "id");

-- CreateIndex — liệt kê lịch sử theo ví, mới→cũ (tab "Ví tạm ứng").
CREATE INDEX "wallet_transaction_tenant_id_wallet_id_created_at_idx" ON "wallet_transaction"("tenant_id", "wallet_id", "created_at");

-- CreateIndex — refund()/revertPayment() tra ngược theo invoice_id.
CREATE INDEX "wallet_transaction_tenant_id_invoice_id_idx" ON "wallet_transaction"("tenant_id", "invoice_id");

ALTER TABLE "wallet_transaction" ADD CONSTRAINT "wallet_transaction_amount_check" CHECK (amount > 0);

-- AddForeignKey
ALTER TABLE "wallet_transaction" ADD CONSTRAINT "wallet_transaction_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, wallet_id): chống trỏ chéo tenant.
ALTER TABLE "wallet_transaction" ADD CONSTRAINT "wallet_transaction_tenant_id_wallet_id_fkey" FOREIGN KEY ("tenant_id", "wallet_id") REFERENCES "patient_wallet"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, invoice_id), NULLABLE (chỉ DEDUCT/REFUND).
ALTER TABLE "wallet_transaction" ADD CONSTRAINT "wallet_transaction_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoice"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, cash_voucher_id), NULLABLE (chỉ TOPUP/SETTLEMENT).
ALTER TABLE "wallet_transaction" ADD CONSTRAINT "wallet_transaction_tenant_id_cash_voucher_id_fkey" FOREIGN KEY ("tenant_id", "cash_voucher_id") REFERENCES "cash_voucher"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1)
ALTER TABLE "wallet_transaction" ADD CONSTRAINT "wallet_transaction_version_check" CHECK (version >= 1);

ALTER TABLE "wallet_transaction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "wallet_transaction"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Seed danh mục toàn hệ thống (không tenant_id) — xem giải thích ở đầu file.
INSERT INTO "reference_catalog" (category, code, name, sort_order, is_active, counts_as_cash)
VALUES ('PAYMENT_METHOD', 'WALLET', 'Ví tạm ứng', 2, true, false);

INSERT INTO "reference_catalog" (category, code, name, sort_order, is_active)
VALUES ('INCOME_EXPENSE_TYPE', 'PATIENT_ADVANCE', 'Tạm ứng bệnh nhân', 0, true);
