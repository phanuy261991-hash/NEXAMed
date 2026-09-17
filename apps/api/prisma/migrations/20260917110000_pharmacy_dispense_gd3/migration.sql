-- Kho Thuốc & Vật tư y tế, Giai đoạn 3 (Xuất kho theo đơn + FEFO + tiền thuốc, docs/DECISIONS.md
-- #163, kế hoạch kỹ thuật C:\Users\Administrator\.claude\plans\fluttering-scribbling-liskov.md,
-- mockup đã duyệt). Bảng MỚI `stock_issue`/`stock_issue_line` (Phiếu xuất kho, luồng 1 BƯỚC — khác
-- `stock_receipt` Nháp→Duyệt) + mở rộng `stock_ledger` (source_issue_id) + `invoice`/`invoice_line`
-- (invoice_type, cho phép N hoá đơn DRUG/lượt khám). Viết tay (không TTY), đúng khuôn
-- 20260917090000_pharmacy_inventory_gd2.

-- ============ Enum ============
CREATE TYPE "stock_issue_type" AS ENUM ('RETAIL_SALE', 'INTERNAL_ALLOCATION', 'SERVICE_CONSUMPTION', 'TRANSFER_OUT', 'RETURN_TO_SUPPLIER', 'WRITE_OFF', 'COUNT_SHORTAGE');
-- KHÔNG có DRAFT/REJECTED như stock_receipt_status — luồng 1 bước.
CREATE TYPE "stock_issue_status" AS ENUM ('POSTED', 'VOIDED');
-- SERVICE = hoá đơn dịch vụ khám (hành vi gốc, mặc định, tối đa 1/lượt khám). DRUG = hoá đơn tiền
-- thuốc (Phiếu xuất kho sinh ra), có thể nhiều dòng/lượt khám.
CREATE TYPE "invoice_type" AS ENUM ('SERVICE', 'DRUG');

-- ============ stock_issue — header phiếu xuất ============
CREATE TABLE "stock_issue" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "issue_no" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "prescription_id" UUID NOT NULL,
    "issue_type" "stock_issue_type" NOT NULL DEFAULT 'RETAIL_SALE',
    "status" "stock_issue_status" NOT NULL DEFAULT 'POSTED',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "voided_by" UUID,
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_issue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_issue_tenant_id_id_key" ON "stock_issue"("tenant_id", "id");
CREATE UNIQUE INDEX "stock_issue_tenant_id_issue_no_key" ON "stock_issue"("tenant_id", "issue_no");
CREATE INDEX "stock_issue_tenant_id_warehouse_id_occurred_at_idx" ON "stock_issue"("tenant_id", "warehouse_id", "occurred_at");
CREATE INDEX "stock_issue_tenant_id_status_idx" ON "stock_issue"("tenant_id", "status");
-- Tra "phiếu xuất của 1 đơn thuốc" (tính đã phát bao nhiêu, cho hàng đợi "Phát thuốc").
CREATE INDEX "stock_issue_tenant_id_prescription_id_idx" ON "stock_issue"("tenant_id", "prescription_id");

ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_tenant_id_prescription_id_fkey" FOREIGN KEY ("tenant_id", "prescription_id") REFERENCES "prescription"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_version_check" CHECK (version >= 1);
-- void_reason bắt buộc khi VOIDED, NULL trạng thái khác — cùng mẫu stock_receipt.rejection_reason.
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_void_reason_check" CHECK (
  ("status" = 'VOIDED' AND "void_reason" IS NOT NULL)
  OR ("status" != 'VOIDED' AND "void_reason" IS NULL)
);

ALTER TABLE "stock_issue" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_issue"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_issue_line — dòng hàng ============
-- prescription_item_id NULL = dòng OTC bán thêm (không theo đơn), CHỈ hợp lệ khi
-- drug.is_prescription_only=false (validate ở Service, không CHECK DB vì cần tra `drug`).
-- quantity là đơn vị CƠ SỞ — không cần quy đổi như stock_receipt_line.
CREATE TABLE "stock_issue_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "prescription_item_id" UUID,
    "drug_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "sell_price" BIGINT NOT NULL,
    "line_amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_issue_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_issue_line_tenant_id_id_key" ON "stock_issue_line"("tenant_id", "id");
CREATE INDEX "stock_issue_line_tenant_id_issue_id_idx" ON "stock_issue_line"("tenant_id", "issue_id");
-- Tính "đã phát" (SUM quantity) của 1 dòng kê đơn — dùng SUM trực tiếp thay vì lưu cột luỹ kế.
CREATE INDEX "stock_issue_line_tenant_id_prescription_item_id_idx" ON "stock_issue_line"("tenant_id", "prescription_item_id");

ALTER TABLE "stock_issue_line" ADD CONSTRAINT "stock_issue_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue_line" ADD CONSTRAINT "stock_issue_line_tenant_id_issue_id_fkey" FOREIGN KEY ("tenant_id", "issue_id") REFERENCES "stock_issue"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue_line" ADD CONSTRAINT "stock_issue_line_tenant_id_prescription_item_id_fkey" FOREIGN KEY ("tenant_id", "prescription_item_id") REFERENCES "prescription_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue_line" ADD CONSTRAINT "stock_issue_line_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue_line" ADD CONSTRAINT "stock_issue_line_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "inventory_batch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue_line" ADD CONSTRAINT "stock_issue_line_version_check" CHECK (version >= 1);
ALTER TABLE "stock_issue_line" ADD CONSTRAINT "stock_issue_line_quantity_check" CHECK (quantity > 0);

ALTER TABLE "stock_issue_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_issue_line"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_ledger — thêm nguồn XUẤT song song nguồn NHẬP đã có ============
ALTER TABLE "stock_ledger" ADD COLUMN "source_issue_id" UUID;
CREATE INDEX "stock_ledger_tenant_id_source_issue_id_idx" ON "stock_ledger"("tenant_id", "source_issue_id");
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_tenant_id_source_issue_id_fkey" FOREIGN KEY ("tenant_id", "source_issue_id") REFERENCES "stock_issue"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============ invoice — invoice_type + đổi unique(tenant_id, encounter_id) sang PARTIAL ============
-- Mặc định SERVICE cho dòng cũ (mọi hoá đơn trước migration này đều là hoá đơn dịch vụ khám).
ALTER TABLE "invoice" ADD COLUMN "invoice_type" "invoice_type" NOT NULL DEFAULT 'SERVICE';

-- Trước GĐ3: unique(tenant_id, encounter_id) TOÀN CỤC ép đúng 1 phiếu thu/lượt khám. Nay chỉ ép
-- đúng 1 hoá đơn SERVICE/lượt khám — cho phép N hoá đơn DRUG/lượt khám (khách quay lại lấy nốt
-- thuốc, hoặc bật pharmacySeparateInvoiceEnabled).
DROP INDEX "invoice_tenant_id_encounter_id_key";
CREATE UNIQUE INDEX "invoice_tenant_id_encounter_id_service_key" ON "invoice"("tenant_id", "encounter_id") WHERE "invoice_type" = 'SERVICE' AND "deleted_at" IS NULL;

-- ============ invoice_line — source_service_item_id nullable + source_stock_issue_line_id mới ============
ALTER TABLE "invoice_line" ALTER COLUMN "source_service_item_id" DROP NOT NULL;
ALTER TABLE "invoice_line" ADD COLUMN "source_stock_issue_line_id" UUID;
CREATE INDEX "invoice_line_tenant_id_source_stock_issue_line_id_idx" ON "invoice_line"("tenant_id", "source_stock_issue_line_id");
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_source_stock_issue_line_id_fkey" FOREIGN KEY ("tenant_id", "source_stock_issue_line_id") REFERENCES "stock_issue_line"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Đúng-1-trong-2 nguồn có giá trị (dịch vụ khám HOẶC tiền thuốc), không bao giờ cả hai/không có gì.
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_source_exactly_one_check" CHECK (
  (("source_service_item_id" IS NOT NULL)::int + ("source_stock_issue_line_id" IS NOT NULL)::int) = 1
);
