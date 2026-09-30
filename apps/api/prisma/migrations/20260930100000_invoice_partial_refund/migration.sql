-- Hoàn tiền MỘT PHẦN theo từng dòng thuốc (docs/DECISIONS.md #203). Viết tay, đúng khuôn các migration
-- gần nhất (8 cột bắt buộc + RLS + composite FK chống trỏ chéo tenant + CHECK version).
--
-- (1) `invoice_refund` — một lần hoàn (sự kiện): lý do, thời điểm, tổng tiền, mã hiển thị `refund_no`.
-- (2) `invoice_refund_line` — dòng nào của hoá đơn được hoàn, bao nhiêu, bao nhiêu tiền, có nhập lại
--     kho không (`restocked`) và phiếu nhập hoàn trả nào đã sinh (`stock_receipt_id`).
-- (3) `payment.refund_id` — gom các dòng payment REFUND của cùng một lần hoàn (nullable: dòng hoàn
--     TOÀN PHẦN cũ từ #085 và mọi dòng PAYMENT không có).
--
-- KHÔNG thêm cột nào vào `invoice`: "đã hoàn" luôn suy ra từ tổng các dòng payment REFUND, đúng nguyên
-- tắc không lưu derived field. Không có CHECK ở DB chặn tổng hoàn vượt tổng đã thu (cần SUM chéo bảng)
-- — chốt chặn là `invoice.version` (optimistic lock) ở tầng service, cùng khuôn mọi thao tác tiền khác.

-- ============ invoice_refund ============
CREATE TABLE "invoice_refund" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "refund_no" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refunded_at" TIMESTAMPTZ(6) NOT NULL,
    "total_amount" BIGINT NOT NULL,

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "invoice_refund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_refund_tenant_id_id_key" ON "invoice_refund"("tenant_id", "id");
CREATE UNIQUE INDEX "invoice_refund_tenant_id_refund_no_key" ON "invoice_refund"("tenant_id", "refund_no");
CREATE INDEX "invoice_refund_tenant_id_invoice_id_idx" ON "invoice_refund"("tenant_id", "invoice_id");

ALTER TABLE "invoice_refund" ADD CONSTRAINT "invoice_refund_total_amount_check" CHECK (total_amount > 0);
ALTER TABLE "invoice_refund" ADD CONSTRAINT "invoice_refund_version_check" CHECK (version >= 1);

ALTER TABLE "invoice_refund" ADD CONSTRAINT "invoice_refund_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_refund" ADD CONSTRAINT "invoice_refund_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoice"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_refund" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "invoice_refund"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ invoice_refund_line ============
CREATE TABLE "invoice_refund_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    "stock_receipt_id" UUID,

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "invoice_refund_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_refund_line_tenant_id_id_key" ON "invoice_refund_line"("tenant_id", "id");
CREATE INDEX "invoice_refund_line_tenant_id_refund_id_idx" ON "invoice_refund_line"("tenant_id", "refund_id");
-- Tổng số lượng đã hoàn theo dòng hoá đơn (kiểm "còn hoàn được") — truy vấn nóng của mọi lần hoàn.
CREATE INDEX "invoice_refund_line_tenant_id_invoice_line_id_idx" ON "invoice_refund_line"("tenant_id", "invoice_line_id");

ALTER TABLE "invoice_refund_line" ADD CONSTRAINT "invoice_refund_line_quantity_check" CHECK (quantity > 0);
ALTER TABLE "invoice_refund_line" ADD CONSTRAINT "invoice_refund_line_amount_check" CHECK (amount >= 0);
-- Chỉ dòng được đánh dấu nhập lại kho mới có phiếu nhập hoàn trả, và ngược lại.
ALTER TABLE "invoice_refund_line" ADD CONSTRAINT "invoice_refund_line_restock_check" CHECK (
  (restocked AND stock_receipt_id IS NOT NULL) OR (NOT restocked AND stock_receipt_id IS NULL)
);
ALTER TABLE "invoice_refund_line" ADD CONSTRAINT "invoice_refund_line_version_check" CHECK (version >= 1);

ALTER TABLE "invoice_refund_line" ADD CONSTRAINT "invoice_refund_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_refund_line" ADD CONSTRAINT "invoice_refund_line_tenant_id_refund_id_fkey" FOREIGN KEY ("tenant_id", "refund_id") REFERENCES "invoice_refund"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_refund_line" ADD CONSTRAINT "invoice_refund_line_tenant_id_invoice_line_id_fkey" FOREIGN KEY ("tenant_id", "invoice_line_id") REFERENCES "invoice_line"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_refund_line" ADD CONSTRAINT "invoice_refund_line_tenant_id_stock_receipt_id_fkey" FOREIGN KEY ("tenant_id", "stock_receipt_id") REFERENCES "stock_receipt"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_refund_line" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "invoice_refund_line"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ payment.refund_id ============
ALTER TABLE "payment" ADD COLUMN "refund_id" UUID;
CREATE INDEX "payment_tenant_id_refund_id_idx" ON "payment"("tenant_id", "refund_id");
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_refund_id_fkey" FOREIGN KEY ("tenant_id", "refund_id") REFERENCES "invoice_refund"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
