-- "Công nợ nhà cung cấp" — Phần E "Đối chiếu & chốt công nợ theo kỳ" (docs/DECISIONS.md #182 câu 3,
-- kế hoạch kỹ thuật C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md mục 4.3/8 +
-- C:\Users\Administrator\.claude\plans\playful-baking-kazoo.md). Viết tay, đúng khuôn Phần A/D
-- (8 cột bắt buộc + RLS + composite FK + CHECK version).
--
-- (1) `supplier_debt_account` thêm `locked_as_of_date` — mốc `asOfDate` của biên bản đối chiếu ĐÃ
--     CHỐT gần nhất (chỉ tăng dần). `null` = chưa từng chốt.
-- (2) Bảng mới `supplier_debt_reconciliation` — "Biên bản đối chiếu" 1 NCC tại 1 ngày.

-- ============ supplier_debt_account.locked_as_of_date ============
ALTER TABLE "supplier_debt_account" ADD COLUMN "locked_as_of_date" TIMESTAMPTZ(6);

-- ============ supplier_debt_reconciliation ============
CREATE TYPE "supplier_debt_reconciliation_status" AS ENUM ('DRAFT', 'FINALIZED', 'CANCELLED');

CREATE TABLE "supplier_debt_reconciliation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "reconciliation_no" TEXT NOT NULL,
    "as_of_date" TIMESTAMPTZ(6) NOT NULL,
    "system_balance" BIGINT NOT NULL,
    "confirmed_balance" BIGINT NOT NULL,
    "difference_amount" BIGINT NOT NULL,
    "resulting_adjustment_id" UUID,
    "status" "supplier_debt_reconciliation_status" NOT NULL DEFAULT 'DRAFT',
    "finalized_by" UUID,
    "finalized_at" TIMESTAMPTZ(6),
    "note" TEXT,

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "supplier_debt_reconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_debt_reconciliation_tenant_id_id_key" ON "supplier_debt_reconciliation"("tenant_id", "id");

-- Tab "Đối chiếu & Chốt kỳ" (trang chi tiết NCC) — lịch sử theo NCC, mới nhất trước.
CREATE INDEX "supplier_debt_reconciliation_tenant_id_supplier_id_idx" ON "supplier_debt_reconciliation"("tenant_id", "supplier_id");
-- Liên kết ngược từ phiếu điều chỉnh tự sinh (rejectAdjustment() cần tra biên bản nào đã sinh ra nó).
CREATE INDEX "supplier_debt_reconciliation_tenant_id_resulting_adjustment_id_idx" ON "supplier_debt_reconciliation"("tenant_id", "resulting_adjustment_id");

ALTER TABLE "supplier_debt_reconciliation" ADD CONSTRAINT "supplier_debt_reconciliation_difference_check" CHECK (
  difference_amount = confirmed_balance - system_balance
);

-- resulting_adjustment_id CHỈ có khi lệch (difference_amount != 0) — khớp lúc chênh lệch = 0 thì
-- không có phiếu điều chỉnh nào tự sinh.
ALTER TABLE "supplier_debt_reconciliation" ADD CONSTRAINT "supplier_debt_reconciliation_adjustment_check" CHECK (
  (difference_amount = 0 AND resulting_adjustment_id IS NULL) OR
  (difference_amount != 0 AND resulting_adjustment_id IS NOT NULL)
);

ALTER TABLE "supplier_debt_reconciliation" ADD CONSTRAINT "supplier_debt_reconciliation_finalized_check" CHECK (
  (status = 'FINALIZED' AND finalized_by IS NOT NULL AND finalized_at IS NOT NULL) OR
  (status != 'FINALIZED' AND finalized_by IS NULL AND finalized_at IS NULL)
);

ALTER TABLE "supplier_debt_reconciliation" ADD CONSTRAINT "supplier_debt_reconciliation_version_check" CHECK (version >= 1);

ALTER TABLE "supplier_debt_reconciliation" ADD CONSTRAINT "supplier_debt_reconciliation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_debt_reconciliation" ADD CONSTRAINT "supplier_debt_reconciliation_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_debt_reconciliation" ADD CONSTRAINT "supplier_debt_reconciliation_tenant_id_resulting_adjustment_id_fkey" FOREIGN KEY ("tenant_id", "resulting_adjustment_id") REFERENCES "supplier_debt_adjustment"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_debt_reconciliation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "supplier_debt_reconciliation"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
