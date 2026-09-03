-- "Chốt ca" (đối soát tiền mặt/két, ngoài kế hoạch, mockup duyệt 2026-09-03) — module
-- `cashier-shift` mới. Viết tay (không `prisma migrate diff`), đúng khuôn
-- 20260827110000_billing_invoice (8 cột bắt buộc + RLS + composite FK) và
-- 20260811024047_patient_s2_01 (partial unique index — C3).
--
-- (1) reference_catalog.counts_as_cash — CHỈ có ý nghĩa với category PAYMENT_METHOD, tách khỏi so
--     khớp cứng code='CASH' (cùng lý do deactivates_account, #063). Backfill dòng CASH có sẵn.
-- (2) Bảng cashier_shift — v1 chỉ 1 két dùng chung toàn tenant: partial unique index chặn có quá
--     1 ca OPEN cùng lúc. Đường mở rộng nhiều két/chi nhánh sau này (#075): đổi index này thành
--     UNIQUE(tenant_id, branch_id) WHERE status='OPEN' khi bảng branch ra đời.

-- AlterTable
ALTER TABLE "reference_catalog" ADD COLUMN "counts_as_cash" BOOLEAN NOT NULL DEFAULT false;

UPDATE "reference_catalog" SET "counts_as_cash" = true WHERE "category" = 'PAYMENT_METHOD' AND "code" = 'CASH';

-- CreateEnum
CREATE TYPE "cashier_shift_status" AS ENUM ('OPEN', 'CLOSED', 'APPROVED');

-- CreateEnum
CREATE TYPE "cashier_shift_discrepancy_resolution" AS ENUM ('DEDUCT', 'INCOME', 'WAIVE');

-- CreateTable
CREATE TABLE "cashier_shift" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "shift_no" TEXT NOT NULL,
    "cashier_id" UUID NOT NULL,
    "shift_label" TEXT NOT NULL,
    "status" "cashier_shift_status" NOT NULL DEFAULT 'OPEN',

    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "opening_float_expected" BIGINT,
    "opening_float_actual" BIGINT NOT NULL,
    "opening_discrepancy_reason" TEXT,

    "closed_at" TIMESTAMPTZ(6),
    "cash_in_amount" BIGINT,
    "cash_out_amount" BIGINT,
    "non_cash_breakdown_json" JSONB,
    "expected_cash_amount" BIGINT,

    "counted_cash_amount" BIGINT,
    "cash_discrepancy_reason" TEXT,
    "keep_for_next_amount" BIGINT,
    "handover_note" TEXT,
    "submitted_amount" BIGINT,

    "resolution_method" "cashier_shift_discrepancy_resolution",
    "resolution_note" TEXT,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),

    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),

    "edited_by" UUID,
    "edited_at" TIMESTAMPTZ(6),

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "cashier_shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cashier_shift_tenant_id_id_key" ON "cashier_shift"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cashier_shift_tenant_id_shift_no_key" ON "cashier_shift"("tenant_id", "shift_no");

-- CreateIndex — tra danh sách theo ngày/khoảng ngày (Danh sách phiếu chốt ca).
CREATE INDEX "cashier_shift_tenant_id_opened_at_idx" ON "cashier_shift"("tenant_id", "opened_at");

-- v1: chỉ 1 két dùng chung toàn tenant — chặn có quá 1 ca OPEN cùng lúc (double bảo vệ cùng
-- CashierShiftAlreadyOpenError ở Service). Không biểu diễn được bằng Prisma @@unique thường.
CREATE UNIQUE INDEX "cashier_shift_one_open_per_tenant"
  ON "cashier_shift" ("tenant_id")
  WHERE "status" = 'OPEN' AND "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "cashier_shift" ADD CONSTRAINT "cashier_shift_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, cashier_id): chống trỏ chéo tenant, cùng mẫu work_shift_assignment.user_id.
ALTER TABLE "cashier_shift" ADD CONSTRAINT "cashier_shift_tenant_id_cashier_id_fkey" FOREIGN KEY ("tenant_id", "cashier_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "cashier_shift" ADD CONSTRAINT "cashier_shift_version_check" CHECK (version >= 1);

ALTER TABLE "cashier_shift" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "cashier_shift"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
