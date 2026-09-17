-- Kho Thuốc & Vật tư y tế, Giai đoạn 2 (Nhập kho & tồn theo lô, docs/DECISIONS.md #146, kế hoạch
-- kỹ thuật C:\Users\Administrator\.claude\plans\precious-humming-goblet.md, mockup đã duyệt). 5
-- bảng MỚI: `stock_receipt`/`stock_receipt_line` (phiếu nhập, luồng Nháp→Duyệt/Từ chối/Huỷ) +
-- `inventory_batch`/`stock_ledger`/`stock_balance` (thẻ kho + tồn kho). Viết tay (không `prisma
-- migrate dev` — môi trường không có TTY, cùng cách `20260915140000_pharmacy_catalog_gd1`).

-- ============ drug: cache "giá nhập gần nhất" ============
ALTER TABLE "drug" ADD COLUMN "last_purchase_unit_cost" BIGINT;
ALTER TABLE "drug" ADD COLUMN "last_purchase_at" TIMESTAMPTZ(6);

-- ============ Enum ============
CREATE TYPE "stock_receipt_type" AS ENUM ('PURCHASE', 'OPENING_BALANCE', 'TRANSFER_IN', 'RETURN_FROM_USE', 'COUNT_SURPLUS');
CREATE TYPE "stock_receipt_status" AS ENUM ('DRAFT', 'POSTED', 'REJECTED');
CREATE TYPE "stock_ledger_reason" AS ENUM ('RECEIPT_PURCHASE', 'RECEIPT_OPENING_BALANCE', 'RECEIPT_TRANSFER_IN', 'RECEIPT_RETURN_FROM_USE', 'RECEIPT_COUNT_SURPLUS', 'RECEIPT_VOID', 'ISSUE_RETAIL_SALE', 'ISSUE_SERVICE_CONSUMPTION', 'ISSUE_INTERNAL_ALLOCATION', 'ISSUE_TRANSFER_OUT', 'ISSUE_RETURN_TO_SUPPLIER', 'ISSUE_WRITE_OFF', 'ISSUE_COUNT_SHORTAGE');

-- ============ stock_receipt — header phiếu nhập ============
CREATE TABLE "stock_receipt" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "supplier_id" UUID,
    "receipt_type" "stock_receipt_type" NOT NULL,
    "status" "stock_receipt_status" NOT NULL DEFAULT 'DRAFT',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,
    "supplier_invoice_no" TEXT,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
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

    CONSTRAINT "stock_receipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_receipt_tenant_id_id_key" ON "stock_receipt"("tenant_id", "id");
CREATE UNIQUE INDEX "stock_receipt_tenant_id_receipt_no_key" ON "stock_receipt"("tenant_id", "receipt_no");
CREATE INDEX "stock_receipt_tenant_id_warehouse_id_occurred_at_idx" ON "stock_receipt"("tenant_id", "warehouse_id", "occurred_at");
CREATE INDEX "stock_receipt_tenant_id_status_idx" ON "stock_receipt"("tenant_id", "status");

ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_version_check" CHECK (version >= 1);
-- receiptType != PURCHASE thì không có nhà cung cấp; PURCHASE bắt buộc phải có (mockup + kế hoạch
-- kỹ thuật mục 5 "Tồn kho ban đầu ... không cần Nhà cung cấp").
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_supplier_matches_type_check" CHECK (
  ("receipt_type" = 'PURCHASE' AND "supplier_id" IS NOT NULL)
  OR ("receipt_type" != 'PURCHASE' AND "supplier_id" IS NULL)
);
-- rejectionReason bắt buộc khi REJECTED, NULL các trạng thái khác.
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_rejection_reason_check" CHECK (
  ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL)
  OR ("status" != 'REJECTED' AND "rejection_reason" IS NULL)
);

ALTER TABLE "stock_receipt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_receipt"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_receipt_line — dòng hàng (chỉ có ý nghĩa lúc DRAFT/vừa POSTED) ============
CREATE TABLE "stock_receipt_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "unit_code" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "batch_no" TEXT,
    "expiry_date" DATE,
    "line_amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_receipt_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_receipt_line_tenant_id_id_key" ON "stock_receipt_line"("tenant_id", "id");
CREATE INDEX "stock_receipt_line_tenant_id_receipt_id_idx" ON "stock_receipt_line"("tenant_id", "receipt_id");

ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_tenant_id_receipt_id_fkey" FOREIGN KEY ("tenant_id", "receipt_id") REFERENCES "stock_receipt"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_version_check" CHECK (version >= 1);
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_quantity_check" CHECK (quantity > 0);

ALTER TABLE "stock_receipt_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_receipt_line"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ inventory_batch — định danh lô ============
CREATE TABLE "inventory_batch" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "batch_no" TEXT NOT NULL,
    "expiry_date" DATE,
    "unit_cost" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "inventory_batch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_batch_tenant_id_id_key" ON "inventory_batch"("tenant_id", "id");
-- Nhập lại đúng batchNo (cùng drug+warehouse) → reuse dòng cũ, không tạo trùng — partial unique
-- (raw SQL, không khai @@unique ở Prisma, cùng lý do drug_unit/drug_ingredient).
CREATE UNIQUE INDEX "inventory_batch_tenant_drug_warehouse_batch_no_key" ON "inventory_batch"("tenant_id", "drug_id", "warehouse_id", "batch_no") WHERE "deleted_at" IS NULL;

ALTER TABLE "inventory_batch" ADD CONSTRAINT "inventory_batch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_batch" ADD CONSTRAINT "inventory_batch_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_batch" ADD CONSTRAINT "inventory_batch_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_batch" ADD CONSTRAINT "inventory_batch_version_check" CHECK (version >= 1);

ALTER TABLE "inventory_batch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inventory_batch"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_ledger — thẻ kho, append-only (nguồn sự thật duy nhất) ============
CREATE TABLE "stock_ledger" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity_change" INTEGER NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "reason" "stock_ledger_reason" NOT NULL,
    "source_receipt_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_ledger_tenant_id_id_key" ON "stock_ledger"("tenant_id", "id");
CREATE INDEX "stock_ledger_tenant_id_drug_id_warehouse_id_occurred_at_idx" ON "stock_ledger"("tenant_id", "drug_id", "warehouse_id", "occurred_at");
CREATE INDEX "stock_ledger_tenant_id_source_receipt_id_idx" ON "stock_ledger"("tenant_id", "source_receipt_id");

ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "inventory_batch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_tenant_id_source_receipt_id_fkey" FOREIGN KEY ("tenant_id", "source_receipt_id") REFERENCES "stock_receipt"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_version_check" CHECK (version >= 1);

ALTER TABLE "stock_ledger" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_ledger"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_balance — cache số dư luỹ kế, cập nhật ĐỒNG BỘ ============
CREATE TABLE "stock_balance" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "average_unit_cost" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_balance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_balance_tenant_id_id_key" ON "stock_balance"("tenant_id", "id");
-- batchId nullable không tự loại trùng qua UNIQUE thường (cùng vấn đề C3/C14) — 2 index riêng.
CREATE UNIQUE INDEX "stock_balance_tenant_drug_warehouse_batch_key" ON "stock_balance"("tenant_id", "drug_id", "warehouse_id", "batch_id") WHERE "batch_id" IS NOT NULL;
CREATE UNIQUE INDEX "stock_balance_tenant_drug_warehouse_no_batch_key" ON "stock_balance"("tenant_id", "drug_id", "warehouse_id") WHERE "batch_id" IS NULL;

ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "inventory_batch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_version_check" CHECK (version >= 1);
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_quantity_on_hand_check" CHECK (quantity_on_hand >= 0);

ALTER TABLE "stock_balance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_balance"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
