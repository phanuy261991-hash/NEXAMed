-- "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 giai đoạn 2, chủ dự án duyệt mockup 12/11/2026).
-- Bảng mới purchase_order / purchase_order_line; stock_receipt.purchase_order_id + stock_receipt_line.purchase_order_line_id nối Phiếu nhập kho
-- liên kết (nhận nhiều đợt, số đã nhận SUY RA từ các dòng phiếu nhập ĐÃ DUYỆT, không lưu trùng); stock_request_line.wait_purchase_order_id +
-- cột "Yêu cầu rút" cho dòng chờ hàng về đã gắn đơn đã đặt NCC. Chi nhánh KẾ THỪA qua kho nhận (không cột branch_id, đúng khuôn stock_request/stock_transfer).
-- Viết tay (không TTY). ALTER TYPE ... ADD VALUE không dùng được giá trị mới trong cùng transaction nên migration này chưa dùng giá trị mới.

ALTER TYPE "PrintDocumentType" ADD VALUE 'PURCHASE_ORDER';

CREATE TYPE "purchase_order_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- ============ purchase_order ============
CREATE TABLE "purchase_order" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "purchase_order_status" NOT NULL DEFAULT 'DRAFT',
    "expected_date" DATE,
    "note" TEXT,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "ordered_at" TIMESTAMPTZ(6),
    "ordered_by" UUID,
    "rejection_reason" TEXT,
    "rejected_at" TIMESTAMPTZ(6),
    "rejected_by" UUID,
    "cancellation_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "closed_reason" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_tenant_id_id_key" ON "purchase_order"("tenant_id", "id");
CREATE UNIQUE INDEX "purchase_order_tenant_id_order_no_key" ON "purchase_order"("tenant_id", "order_no");
CREATE INDEX "purchase_order_tenant_id_warehouse_id_idx" ON "purchase_order"("tenant_id", "warehouse_id");
CREATE INDEX "purchase_order_tenant_id_supplier_id_idx" ON "purchase_order"("tenant_id", "supplier_id");
CREATE INDEX "purchase_order_tenant_id_status_idx" ON "purchase_order"("tenant_id", "status");

ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplier_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_warehouse_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_version_check" CHECK (version >= 1);
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_total_check" CHECK (total_amount >= 0);
-- Từ chối / huỷ / đóng đơn bắt buộc có lý do; các trạng thái khác thì không có.
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_rejection_reason_check" CHECK (
  ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL) OR ("status" != 'REJECTED' AND "rejection_reason" IS NULL)
);
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_cancellation_reason_check" CHECK (
  ("status" = 'CANCELLED' AND "cancellation_reason" IS NOT NULL) OR ("status" != 'CANCELLED' AND "cancellation_reason" IS NULL)
);
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_closed_reason_check" CHECK (
  ("status" = 'CLOSED' AND "closed_reason" IS NOT NULL) OR ("status" != 'CLOSED' AND "closed_reason" IS NULL)
);

ALTER TABLE "purchase_order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_order"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ purchase_order_line ============
CREATE TABLE "purchase_order_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "unit_code" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expected_unit_cost" BIGINT,
    "line_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "purchase_order_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_line_tenant_id_id_key" ON "purchase_order_line"("tenant_id", "id");
CREATE INDEX "purchase_order_line_tenant_id_order_id_idx" ON "purchase_order_line"("tenant_id", "order_id");
CREATE INDEX "purchase_order_line_tenant_id_drug_id_idx" ON "purchase_order_line"("tenant_id", "drug_id");
-- Một mặt hàng chỉ một dòng trên cùng đơn (dòng đã xoá mềm do sửa bản nháp không tính).
CREATE UNIQUE INDEX "purchase_order_line_order_drug_active_key" ON "purchase_order_line"("tenant_id", "order_id", "drug_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_order_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "purchase_order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_drug_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_version_check" CHECK (version >= 1);
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_quantity_check" CHECK (quantity > 0);
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_cost_check" CHECK (expected_unit_cost IS NULL OR expected_unit_cost >= 0);

ALTER TABLE "purchase_order_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_order_line"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ Phiếu nhập kho liên kết với đơn ============
ALTER TABLE "stock_receipt" ADD COLUMN "purchase_order_id" UUID;
CREATE INDEX "stock_receipt_tenant_id_purchase_order_id_idx" ON "stock_receipt"("tenant_id", "purchase_order_id");
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_purchase_order_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id") REFERENCES "purchase_order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_receipt_line" ADD COLUMN "purchase_order_line_id" UUID;
CREATE INDEX "stock_receipt_line_tenant_id_purchase_order_line_id_idx" ON "stock_receipt_line"("tenant_id", "purchase_order_line_id");
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_purchase_order_line_fkey" FOREIGN KEY ("tenant_id", "purchase_order_line_id") REFERENCES "purchase_order_line"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============ Dòng yêu cầu cấp hàng: chờ hàng của đơn NCC + "Yêu cầu rút" ============
ALTER TABLE "stock_request_line" ADD COLUMN "wait_purchase_order_id" UUID;
ALTER TABLE "stock_request_line" ADD COLUMN "withdraw_requested_at" TIMESTAMPTZ(6);
ALTER TABLE "stock_request_line" ADD COLUMN "withdraw_requested_by" UUID;
ALTER TABLE "stock_request_line" ADD COLUMN "withdraw_request_reason" TEXT;
CREATE INDEX "stock_request_line_tenant_id_wait_purchase_order_id_idx" ON "stock_request_line"("tenant_id", "wait_purchase_order_id");
ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_wait_purchase_order_fkey" FOREIGN KEY ("tenant_id", "wait_purchase_order_id") REFERENCES "purchase_order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Yêu cầu rút phải có đủ thời điểm + lý do.
ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_withdraw_request_check" CHECK (
  "withdraw_requested_at" IS NULL OR "withdraw_request_reason" IS NOT NULL
);
