-- "Yêu cầu cấp hàng" theo cấp (docs/DECISIONS.md #298, chủ dự án duyệt mockup 12/11/2026), giai đoạn 1.
-- Bảng mới stock_request / stock_request_line / stock_request_event; stock_transfer.request_id và stock_transfer_line.request_line_id
-- nối phiếu điều chuyển sinh ra từ yêu cầu. Chi nhánh KẾ THỪA qua kho xin/kho cấp (không cột branch_id, đúng khuôn stock_transfer #233).
-- Viết tay (không TTY). ALTER TYPE ... ADD VALUE không dùng được giá trị mới trong cùng transaction nên migration này chưa dùng giá trị mới.

ALTER TYPE "PrintDocumentType" ADD VALUE 'STOCK_REQUEST';

CREATE TYPE "stock_request_status" AS ENUM ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED', 'WITHDRAWN');
CREATE TYPE "stock_request_priority" AS ENUM ('NORMAL', 'URGENT');
CREATE TYPE "stock_request_line_status" AS ENUM ('PENDING', 'WAITING_STOCK', 'ALLOCATED', 'REJECTED', 'WITHDRAWN');

-- ============ stock_request ============
CREATE TABLE "stock_request" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "request_no" TEXT NOT NULL,
    "requesting_warehouse_id" UUID NOT NULL,
    "supplying_warehouse_id" UUID NOT NULL,
    "status" "stock_request_status" NOT NULL DEFAULT 'DRAFT',
    "priority" "stock_request_priority" NOT NULL DEFAULT 'NORMAL',
    "needed_by" DATE,
    "note" TEXT,
    "parent_request_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_by" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "rejected_at" TIMESTAMPTZ(6),
    "rejected_by" UUID,
    "cancellation_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "supplier_update_pending" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_request_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_request_tenant_id_id_key" ON "stock_request"("tenant_id", "id");
CREATE UNIQUE INDEX "stock_request_tenant_id_request_no_key" ON "stock_request"("tenant_id", "request_no");
CREATE INDEX "stock_request_tenant_id_requesting_warehouse_id_idx" ON "stock_request"("tenant_id", "requesting_warehouse_id");
CREATE INDEX "stock_request_tenant_id_supplying_warehouse_id_idx" ON "stock_request"("tenant_id", "supplying_warehouse_id");
CREATE INDEX "stock_request_tenant_id_status_idx" ON "stock_request"("tenant_id", "status");
CREATE INDEX "stock_request_tenant_id_parent_request_id_idx" ON "stock_request"("tenant_id", "parent_request_id");

ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_requesting_warehouse_fkey" FOREIGN KEY ("tenant_id", "requesting_warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_supplying_warehouse_fkey" FOREIGN KEY ("tenant_id", "supplying_warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_parent_fkey" FOREIGN KEY ("tenant_id", "parent_request_id") REFERENCES "stock_request"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_version_check" CHECK (version >= 1);
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_warehouses_check" CHECK ("requesting_warehouse_id" != "supplying_warehouse_id");
-- Từ chối cả phiếu / huỷ phiếu bắt buộc có lý do; các trạng thái khác thì không có.
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_rejection_reason_check" CHECK (
  ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL) OR ("status" != 'REJECTED' AND "rejection_reason" IS NULL)
);
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_cancellation_reason_check" CHECK (
  ("status" = 'CANCELLED' AND "cancellation_reason" IS NOT NULL) OR ("status" != 'CANCELLED' AND "cancellation_reason" IS NULL)
);

ALTER TABLE "stock_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_request"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_request_line ============
CREATE TABLE "stock_request_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "requested_qty" INTEGER NOT NULL,
    "requester_stock_snapshot" INTEGER,
    "line_note" TEXT,
    "fulfil_status" "stock_request_line_status" NOT NULL DEFAULT 'PENDING',
    "decision_reason" TEXT,
    "wait_expected_date" DATE,
    "wait_child_request_id" UUID,
    "added_after_accept" BOOLEAN NOT NULL DEFAULT false,
    "withdraw_reason" TEXT,
    "withdrawn_at" TIMESTAMPTZ(6),
    "withdrawn_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_request_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_request_line_tenant_id_id_key" ON "stock_request_line"("tenant_id", "id");
CREATE INDEX "stock_request_line_tenant_id_request_id_idx" ON "stock_request_line"("tenant_id", "request_id");
CREATE INDEX "stock_request_line_tenant_id_drug_id_idx" ON "stock_request_line"("tenant_id", "drug_id");
-- Một mặt hàng chỉ một dòng trên cùng phiếu (dòng đã xoá mềm do sửa bản nháp không tính).
CREATE UNIQUE INDEX "stock_request_line_request_drug_active_key" ON "stock_request_line"("tenant_id", "request_id", "drug_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_request_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "stock_request"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_drug_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_wait_child_fkey" FOREIGN KEY ("tenant_id", "wait_child_request_id") REFERENCES "stock_request"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_version_check" CHECK (version >= 1);
ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_requested_qty_check" CHECK (requested_qty > 0);
ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_snapshot_check" CHECK (requester_stock_snapshot IS NULL OR requester_stock_snapshot >= 0);
-- Từ chối và Chờ hàng về đều bắt buộc có lý do; Rút dòng bắt buộc có lý do và thời điểm.
ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_decision_reason_check" CHECK (
  "fulfil_status" NOT IN ('REJECTED', 'WAITING_STOCK') OR "decision_reason" IS NOT NULL
);
ALTER TABLE "stock_request_line" ADD CONSTRAINT "stock_request_line_withdraw_check" CHECK (
  "fulfil_status" != 'WITHDRAWN' OR ("withdraw_reason" IS NOT NULL AND "withdrawn_at" IS NOT NULL)
);

ALTER TABLE "stock_request_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_request_line"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_request_event — diễn biến hiển thị, chỉ thêm ============
CREATE TABLE "stock_request_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "stock_request_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_request_event_tenant_id_id_key" ON "stock_request_event"("tenant_id", "id");
CREATE INDEX "stock_request_event_tenant_id_request_id_idx" ON "stock_request_event"("tenant_id", "request_id");

ALTER TABLE "stock_request_event" ADD CONSTRAINT "stock_request_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request_event" ADD CONSTRAINT "stock_request_event_request_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "stock_request"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_request_event" ADD CONSTRAINT "stock_request_event_version_check" CHECK (version >= 1);

ALTER TABLE "stock_request_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_request_event"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_transfer / stock_transfer_line — liên kết ngược về yêu cầu ============
ALTER TABLE "stock_transfer" ADD COLUMN "request_id" UUID;
CREATE INDEX "stock_transfer_tenant_id_request_id_idx" ON "stock_transfer"("tenant_id", "request_id");
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_request_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "stock_request"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_line" ADD COLUMN "request_line_id" UUID;
CREATE INDEX "stock_transfer_line_tenant_id_request_line_id_idx" ON "stock_transfer_line"("tenant_id", "request_line_id");
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_request_line_fkey" FOREIGN KEY ("tenant_id", "request_line_id") REFERENCES "stock_request_line"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
