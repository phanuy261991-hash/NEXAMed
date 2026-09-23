-- Kho Thuốc & Vật tư y tế, Giai đoạn 4 — phần "Điều chuyển kho" (docs/DECISIONS.md #170, kế hoạch
-- kỹ thuật C:\Users\Administrator\.claude\plans\bright-bubbling-axolotl.md, mockup đã duyệt). Bảng
-- MỚI `stock_transfer`/`stock_transfer_line` (1 luồng duy nhất tự sinh cặp chứng từ liên kết, tách
-- 2 bước Duyệt(xuất)/Xác nhận nhận hàng) + mở rộng `stock_receipt`/`stock_issue` (transfer_id, trỏ
-- ngược về phiếu điều chuyển tự sinh ra chúng — cùng khuôn count_id đã thêm ở migration
-- 20260922100000_stock_count_ge4). Viết tay (không TTY), đúng khuôn migration đó.

-- ============ Enum ============
CREATE TYPE "stock_transfer_status" AS ENUM ('DRAFT', 'IN_TRANSIT', 'COMPLETED', 'REJECTED');

-- ============ stock_transfer — header phiếu điều chuyển ============
CREATE TABLE "stock_transfer" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "transfer_no" TEXT NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "status" "stock_transfer_status" NOT NULL DEFAULT 'DRAFT',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,
    "shipped_by" UUID,
    "shipped_at" TIMESTAMPTZ(6),
    "received_by" UUID,
    "received_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_transfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfer_tenant_id_id_key" ON "stock_transfer"("tenant_id", "id");
CREATE UNIQUE INDEX "stock_transfer_tenant_id_transfer_no_key" ON "stock_transfer"("tenant_id", "transfer_no");
CREATE INDEX "stock_transfer_tenant_id_from_warehouse_id_idx" ON "stock_transfer"("tenant_id", "from_warehouse_id");
CREATE INDEX "stock_transfer_tenant_id_to_warehouse_id_idx" ON "stock_transfer"("tenant_id", "to_warehouse_id");
CREATE INDEX "stock_transfer_tenant_id_status_idx" ON "stock_transfer"("tenant_id", "status");

ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_tenant_id_from_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "from_warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_tenant_id_to_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "to_warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_version_check" CHECK (version >= 1);
-- Không tự chuyển cho chính kho đó — mọi mockup/kế hoạch đều giả định 2 kho khác nhau.
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_to_warehouse_check" CHECK ("from_warehouse_id" != "to_warehouse_id");
-- rejection_reason bắt buộc khi REJECTED, NULL trạng thái khác — cùng mẫu stock_count/stock_receipt.
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_rejection_reason_check" CHECK (
  ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL)
  OR ("status" != 'REJECTED' AND "rejection_reason" IS NULL)
);

ALTER TABLE "stock_transfer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_transfer"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_transfer_line — dòng hàng điều chuyển ============
-- batch_id = lô ĐÃ tồn tại TẠI KHO NGUỒN (không có khái niệm "lô mới" như Kiểm kê — hàng phải có
-- thật mới chuyển được). unit_cost snapshot lúc Duyệt xuất, NULL tới khi đó. quantity_received/
-- variance_note NULL tới khi Xác nhận nhận hàng.
CREATE TABLE "stock_transfer_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity_shipped" INTEGER NOT NULL,
    "unit_cost" BIGINT,
    "quantity_received" INTEGER,
    "variance_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_transfer_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfer_line_tenant_id_id_key" ON "stock_transfer_line"("tenant_id", "id");
CREATE INDEX "stock_transfer_line_tenant_id_transfer_id_idx" ON "stock_transfer_line"("tenant_id", "transfer_id");

ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_tenant_id_transfer_id_fkey" FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "stock_transfer"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "inventory_batch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_version_check" CHECK (version >= 1);
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_quantity_shipped_check" CHECK (quantity_shipped > 0);
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_quantity_received_check" CHECK (quantity_received IS NULL OR quantity_received >= 0);
-- Chặn CỨNG nhận nhiều hơn đã xuất — quyết định đã chốt (kế hoạch #170 mục 8), phòng vệ ở tầng DB
-- cộng thêm tầng Service.
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_received_not_exceed_shipped_check" CHECK (quantity_received IS NULL OR quantity_received <= quantity_shipped);
-- Bắt buộc ghi lý do khi nhận ÍT hơn đã xuất (đủ/chưa xác nhận thì không cần).
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_variance_note_check" CHECK (
  quantity_received IS NULL OR quantity_received = quantity_shipped OR variance_note IS NOT NULL
);

ALTER TABLE "stock_transfer_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_transfer_line"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_receipt — transfer_id (trỏ ngược, phiếu tự sinh từ Điều chuyển) ============
ALTER TABLE "stock_receipt" ADD COLUMN "transfer_id" UUID;
CREATE INDEX "stock_receipt_tenant_id_transfer_id_idx" ON "stock_receipt"("tenant_id", "transfer_id");
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_tenant_id_transfer_id_fkey" FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "stock_transfer"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============ stock_issue — transfer_id (trỏ ngược, phiếu tự sinh từ Điều chuyển) ============
ALTER TABLE "stock_issue" ADD COLUMN "transfer_id" UUID;
CREATE INDEX "stock_issue_tenant_id_transfer_id_idx" ON "stock_issue"("tenant_id", "transfer_id");
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_tenant_id_transfer_id_fkey" FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "stock_transfer"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
