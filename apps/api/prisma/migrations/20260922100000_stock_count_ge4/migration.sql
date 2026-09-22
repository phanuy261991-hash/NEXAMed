-- Kho Thuốc & Vật tư y tế, Giai đoạn 4 — phần "Kiểm kê" (docs/DECISIONS.md #170, kế hoạch kỹ thuật
-- C:\Users\Administrator\.claude\plans\bright-bubbling-axolotl.md, mockup đã duyệt). Bảng MỚI
-- `stock_count`/`stock_count_line` (Phiếu kiểm kê, luồng Nháp→Duyệt/Từ chối — đúng khuôn
-- `stock_receipt`) + mở rộng `stock_receipt`/`stock_issue` (count_id, trỏ ngược về phiếu kiểm kê tự
-- sinh dư/thiếu) + nới `stock_issue.prescription_id` NULLABLE (COUNT_SHORTAGE không gắn đơn thuốc).
-- Viết tay (không TTY), đúng khuôn 20260917110000_pharmacy_dispense_gd3.

-- ============ Enum ============
CREATE TYPE "stock_count_status" AS ENUM ('DRAFT', 'POSTED', 'REJECTED');

-- ============ stock_count — header phiếu kiểm kê ============
CREATE TABLE "stock_count" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "count_no" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "stock_count_status" NOT NULL DEFAULT 'DRAFT',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,
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

    CONSTRAINT "stock_count_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_count_tenant_id_id_key" ON "stock_count"("tenant_id", "id");
CREATE UNIQUE INDEX "stock_count_tenant_id_count_no_key" ON "stock_count"("tenant_id", "count_no");
CREATE INDEX "stock_count_tenant_id_warehouse_id_occurred_at_idx" ON "stock_count"("tenant_id", "warehouse_id", "occurred_at");
CREATE INDEX "stock_count_tenant_id_status_idx" ON "stock_count"("tenant_id", "status");

ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_version_check" CHECK (version >= 1);
-- rejection_reason bắt buộc khi REJECTED, NULL trạng thái khác — cùng mẫu stock_receipt.
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_rejection_reason_check" CHECK (
  ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL)
  OR ("status" != 'REJECTED' AND "rejection_reason" IS NULL)
);

ALTER TABLE "stock_count" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_count"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_count_line — dòng đếm ============
-- batch_id có giá trị = lô ĐÃ tồn tại lúc thêm dòng; batch_id=null + new_batch_no có giá trị = lô
-- MỚI phát hiện lúc đếm (find-or-create lúc Duyệt); cả 2 đều null = hàng KHÔNG quản lý theo lô.
-- difference CHỈ có giá trị SAU khi Duyệt (lưu lại số đã dùng để sinh dư/thiếu).
CREATE TABLE "stock_count_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "batch_id" UUID,
    "new_batch_no" TEXT,
    "new_batch_expiry_date" DATE,
    "system_quantity_snapshot" INTEGER NOT NULL,
    "counted_quantity" INTEGER NOT NULL,
    "difference" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_count_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_count_line_tenant_id_id_key" ON "stock_count_line"("tenant_id", "id");
CREATE INDEX "stock_count_line_tenant_id_count_id_idx" ON "stock_count_line"("tenant_id", "count_id");

ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_tenant_id_count_id_fkey" FOREIGN KEY ("tenant_id", "count_id") REFERENCES "stock_count"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "inventory_batch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_version_check" CHECK (version >= 1);
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_counted_quantity_check" CHECK (counted_quantity >= 0);
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_system_quantity_snapshot_check" CHECK (system_quantity_snapshot >= 0);

ALTER TABLE "stock_count_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_count_line"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_receipt — count_id (trỏ ngược, phiếu tự sinh từ Kiểm kê) ============
ALTER TABLE "stock_receipt" ADD COLUMN "count_id" UUID;
CREATE INDEX "stock_receipt_tenant_id_count_id_idx" ON "stock_receipt"("tenant_id", "count_id");
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_tenant_id_count_id_fkey" FOREIGN KEY ("tenant_id", "count_id") REFERENCES "stock_count"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============ stock_issue — prescription_id NULLABLE + count_id mới ============
-- COUNT_SHORTAGE (tự sinh lúc Duyệt Kiểm kê phát hiện thiếu) không gắn với đơn thuốc nào.
ALTER TABLE "stock_issue" ALTER COLUMN "prescription_id" DROP NOT NULL;
ALTER TABLE "stock_issue" ADD COLUMN "count_id" UUID;
CREATE INDEX "stock_issue_tenant_id_count_id_idx" ON "stock_issue"("tenant_id", "count_id");
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_tenant_id_count_id_fkey" FOREIGN KEY ("tenant_id", "count_id") REFERENCES "stock_count"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Đúng-1-theo-loại: RETAIL_SALE bắt buộc có prescription_id, mọi issueType khác bắt buộc KHÔNG có.
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_prescription_id_by_type_check" CHECK (
  ("issue_type" = 'RETAIL_SALE' AND "prescription_id" IS NOT NULL)
  OR ("issue_type" != 'RETAIL_SALE' AND "prescription_id" IS NULL)
);
