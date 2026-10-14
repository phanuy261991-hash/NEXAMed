-- Tầng CHI NHÁNH, Đợt 2 — Tiền & Kho (docs/DECISIONS.md #233, mockup chốt 14/10/2026).
--
--  1. `branch_id` NOT NULL (composite FK `(tenant_id, branch_id)`) cho `warehouse`, `cash_account`, `cashier_shift` — backfill = chi nhánh mặc
--     định của tenant, nên công ty 1 chi nhánh KHÔNG đổi gì. Phiếu nhập/xuất/kiểm kê/điều chuyển, tồn, lô, thẻ kho kế thừa chi nhánh qua kho;
--     phiếu thu/chi/chuyển quỹ kế thừa qua quỹ; hoá đơn/thanh toán kế thừa qua lượt khám (đã có từ Đợt 1) — không thêm cột cho các bảng này.
--  2. Các unique "mặc định" chuyển từ theo tenant sang theo (tenant, chi nhánh): 1 kho mặc định/chi nhánh, 1 quỹ mặc định mỗi loại/chi nhánh,
--     1 ca thu ngân mở/thu ngân/chi nhánh (Q6).
--  3. Điều chuyển kho: luồng KIỂM NHẬN (nhận thiếu → chờ bên gửi xử lý), TỪ CHỐI nhận cả phiếu → đang hoàn trả → đã hoàn trả. Thêm 3 trạng thái,
--     cột lý do/xử lý trên dòng phiếu và loại phiếu nhập `TRANSFER_RETURN` (hàng quay về kho gửi).
--
-- Forward-only. Chạy bằng role đặc quyền (migrate) nên không bị RLS chặn khi backfill chéo tenant.

-- ======================================================================================================================
-- 1. Giá trị enum mới (KHÔNG dùng giá trị mới trong cùng migration — ràng buộc của ALTER TYPE ... ADD VALUE)
-- ======================================================================================================================
ALTER TYPE "stock_receipt_type" ADD VALUE 'TRANSFER_RETURN';
ALTER TYPE "stock_ledger_reason" ADD VALUE 'RECEIPT_TRANSFER_RETURN';
ALTER TYPE "stock_transfer_status" ADD VALUE 'VARIANCE_PENDING';
ALTER TYPE "stock_transfer_status" ADD VALUE 'RETURNING';
ALTER TYPE "stock_transfer_status" ADD VALUE 'RETURNED';

-- ======================================================================================================================
-- 2. branch_id NOT NULL cho kho / quỹ / ca thu ngân
-- ======================================================================================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['warehouse', 'cash_account', 'cashier_shift'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "branch_id" UUID', tbl);
    EXECUTE format(
      'UPDATE %I x SET "branch_id" = b."id" FROM "branch" b WHERE b."tenant_id" = x."tenant_id" AND b."is_default" AND b."deleted_at" IS NULL',
      tbl
    );
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "branch_id" SET NOT NULL', tbl);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
      tbl, tbl || '_tenant_id_branch_id_fkey'
    );
    EXECUTE format('CREATE INDEX %I ON %I ("tenant_id", "branch_id")', tbl || '_tenant_id_branch_id_idx', tbl);
  END LOOP;
END
$$;

-- ======================================================================================================================
-- 3. Unique "mặc định" / "ca mở" theo chi nhánh
-- ======================================================================================================================
DROP INDEX "warehouse_tenant_id_default_key";
CREATE UNIQUE INDEX "warehouse_tenant_id_branch_id_default_key"
  ON "warehouse" ("tenant_id", "branch_id")
  WHERE "is_default" AND "deleted_at" IS NULL;

DROP INDEX "cash_account_one_default_per_type";
CREATE UNIQUE INDEX "cash_account_one_default_per_type"
  ON "cash_account" ("tenant_id", "branch_id", "type")
  WHERE "is_default" = true AND "deleted_at" IS NULL;

DROP INDEX "cashier_shift_one_open_per_cashier";
CREATE UNIQUE INDEX "cashier_shift_one_open_per_cashier"
  ON "cashier_shift" ("tenant_id", "cashier_id", "branch_id")
  WHERE "status" = 'OPEN' AND "deleted_at" IS NULL;

-- ======================================================================================================================
-- 4. Điều chuyển kho: kiểm nhận / từ chối nhận / hoàn trả
-- ======================================================================================================================
ALTER TABLE "stock_transfer"
  ADD COLUMN "receive_reject_reason_code" TEXT,
  ADD COLUMN "receive_reject_note" TEXT,
  ADD COLUMN "receive_rejected_by" UUID,
  ADD COLUMN "receive_rejected_at" TIMESTAMPTZ(6),
  ADD COLUMN "return_confirmed_by" UUID,
  ADD COLUMN "return_confirmed_at" TIMESTAMPTZ(6),
  ADD COLUMN "variance_resolved_by" UUID,
  ADD COLUMN "variance_resolved_at" TIMESTAMPTZ(6),
  ADD COLUMN "variance_resolution_note" TEXT;

ALTER TABLE "stock_transfer_line"
  ADD COLUMN "variance_reason_code" TEXT,
  ADD COLUMN "variance_resolution" TEXT,
  ADD COLUMN "quantity_returned_back" INTEGER,
  ADD COLUMN "return_variance_note" TEXT;

ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_variance_reason_code_check"
  CHECK ("variance_reason_code" IS NULL OR "variance_reason_code" IN ('SHORTAGE', 'DAMAGED', 'EXPIRED', 'WRONG_ITEM', 'OTHER'));
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_variance_resolution_check"
  CHECK ("variance_resolution" IS NULL OR "variance_resolution" IN ('RETURN_TO_SOURCE', 'WRITE_OFF'));
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_returned_back_check"
  CHECK ("quantity_returned_back" IS NULL OR ("quantity_returned_back" >= 0 AND "quantity_returned_back" <= "quantity_shipped"));
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_receive_reject_reason_code_check"
  CHECK ("receive_reject_reason_code" IS NULL OR "receive_reject_reason_code" IN ('WRONG_ITEM', 'DAMAGED', 'EXPIRED', 'OTHER'));
