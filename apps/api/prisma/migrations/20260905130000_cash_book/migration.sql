-- "Thu chi tại quầy" (Sổ quỹ & Thu chi, Giai đoạn 1) — mockup Artifact duyệt trước khi code (thu
-- ngân đang mở ca lập được Phiếu thu/Phiếu chi ngoài dịch vụ khám: tiền điện, tiền nước, bán phế
-- liệu...). Viết tay (không `prisma migrate diff`), đúng khuôn 20260903180000_cashier_shift (8 cột
-- bắt buộc + RLS + composite FK + partial unique index).
--
-- (1) Bảng `cash_account` (Quỹ) — theo tenant. `type` khai sẵn 'DRAWER' (két thu ngân) dù GĐ1 CHƯA
--     dùng tới — chỉ để Giai đoạn 2 bật công tắc "Thủ quỹ riêng" mà không phải ALTER TYPE thêm giá
--     trị enum giữa chừng (Postgres không cho dùng giá trị enum mới thêm trong CÙNG transaction).
-- (2) Bảng `cash_voucher` (Phiếu thu/Phiếu chi) — MỘT bảng cho cả 2 chiều tiền, phân biệt bằng
--     `direction` (dùng LẠI enum `reference_catalog_direction` có sẵn từ #121 — cùng khái niệm
--     Thu/Chi, không tạo enum trùng lặp).
-- (3) `payment.cash_account_id` (nullable) — quỹ nhận/xuất tiền của dòng thu/hoàn tiền khám, để
--     Sổ quỹ (Giai đoạn 2) không phải backfill khi tới lượt làm.
-- (4) `cashier_shift.other_cash_in_amount`/`other_cash_out_amount` (nullable) — snapshot lúc chốt
--     ca, tách bạch "thu khám" khỏi "thu/chi khác" trên phiếu in. KHÔNG đổi công thức
--     expected_cash_amount hiện có.

-- CreateEnum
CREATE TYPE "cash_account_type" AS ENUM ('CASH', 'BANK', 'DRAWER');

-- CreateTable
CREATE TABLE "cash_account" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "cash_account_type" NOT NULL,
    "bank_name" TEXT,
    "bank_account_no" TEXT,
    "opening_balance" BIGINT NOT NULL DEFAULT 0,
    "opening_balance_at" TIMESTAMPTZ(6) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "cash_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_account_tenant_id_id_key" ON "cash_account"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_account_tenant_id_code_key" ON "cash_account"("tenant_id", "code");

-- Mỗi loại quỹ (CASH/BANK/DRAWER) chỉ có đúng 1 quỹ mặc định/tenant — Prisma không biểu diễn được
-- unique có điều kiện WHERE (cùng lý do C3 patient.national_id_hash).
CREATE UNIQUE INDEX "cash_account_one_default_per_type"
  ON "cash_account" ("tenant_id", "type")
  WHERE "is_default" = true AND "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "cash_account" ADD CONSTRAINT "cash_account_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "cash_account" ADD CONSTRAINT "cash_account_version_check" CHECK (version >= 1);

ALTER TABLE "cash_account" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "cash_account"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- CreateEnum
CREATE TYPE "cash_voucher_status" AS ENUM ('POSTED', 'PENDING_APPROVAL', 'REJECTED');

-- CreateTable
CREATE TABLE "cash_voucher" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "voucher_no" TEXT NOT NULL,
    "direction" "reference_catalog_direction" NOT NULL,
    "income_expense_type_code" TEXT NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "payment_method_code" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "partner_name" TEXT,
    "description" TEXT NOT NULL,
    "note" TEXT,
    "status" "cash_voucher_status" NOT NULL DEFAULT 'POSTED',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "cashier_shift_id" UUID,
    "printed_at" TIMESTAMPTZ(6),

    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "cash_voucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_voucher_tenant_id_id_key" ON "cash_voucher"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_voucher_tenant_id_voucher_no_key" ON "cash_voucher"("tenant_id", "voucher_no");

-- CreateIndex — tra danh sách theo ngày/khoảng ngày (màn "Phiếu thu/Phiếu chi").
CREATE INDEX "cash_voucher_tenant_id_occurred_at_idx" ON "cash_voucher"("tenant_id", "occurred_at");

-- CreateIndex — nối vào tổng kết ca (CashierShiftService.computeTotals(), "Đa thu ngân").
CREATE INDEX "cash_voucher_tenant_id_cashier_shift_id_idx" ON "cash_voucher"("tenant_id", "cashier_shift_id");

-- CreateIndex — phục vụ Sổ quỹ (Giai đoạn 2, tra theo quỹ + khoảng ngày).
CREATE INDEX "cash_voucher_tenant_id_cash_account_id_occurred_at_idx" ON "cash_voucher"("tenant_id", "cash_account_id", "occurred_at");

ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_amount_check" CHECK (amount > 0);

-- AddForeignKey
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, cash_account_id): chống trỏ chéo tenant.
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_tenant_id_cash_account_id_fkey" FOREIGN KEY ("tenant_id", "cash_account_id") REFERENCES "cash_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, cashier_shift_id), NULLABLE.
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_tenant_id_cashier_shift_id_fkey" FOREIGN KEY ("tenant_id", "cashier_shift_id") REFERENCES "cashier_shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1)
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_version_check" CHECK (version >= 1);

ALTER TABLE "cash_voucher" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "cash_voucher"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- AlterTable — payment: quỹ nhận/xuất tiền của dòng thu/hoàn tiền khám (nullable, không backfill).
ALTER TABLE "payment" ADD COLUMN "cash_account_id" UUID;

CREATE INDEX "payment_tenant_id_cash_account_id_idx" ON "payment"("tenant_id", "cash_account_id");

ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_cash_account_id_fkey" FOREIGN KEY ("tenant_id", "cash_account_id") REFERENCES "cash_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable — cashier_shift: snapshot lúc chốt, tách bạch "thu/chi khác" trên phiếu in (nullable, không backfill).
ALTER TABLE "cashier_shift" ADD COLUMN "other_cash_in_amount" BIGINT;
ALTER TABLE "cashier_shift" ADD COLUMN "other_cash_out_amount" BIGINT;
