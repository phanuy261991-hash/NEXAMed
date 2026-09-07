-- "Sổ quỹ & Thu chi" Giai đoạn 2 (Sổ quỹ + Báo cáo dòng tiền + Thủ quỹ riêng + Chuyển quỹ) — kế
-- hoạch duyệt trước khi code (jiggly-meandering-leaf.md). Viết tay (không `prisma migrate diff`),
-- đúng khuôn 20260905130000_cash_book (composite FK + CHECK + index).
--
-- (1) `cash_voucher`: thêm `counter_account_id` (nullable) — có giá trị = phiếu "Chuyển quỹ" (di
--     chuyển tiền giữa 2 quỹ NỘI BỘ, không phải Thu/Chi thật). `income_expense_type_code` đổi
--     NOT NULL -> NULLABLE (chỉ bắt buộc cho phiếu Thu/Chi thường, KHÔNG cho Chuyển quỹ) — CHECK
--     mới ép đúng 1 trong 2 hình dạng. `is_auto_generated` đánh dấu phiếu Chuyển quỹ tự sinh lúc
--     Chốt ca (Thủ quỹ riêng) khác phiếu lập tay.
-- (2) `cash_account`: thêm `owner_user_id` (nullable) — CHỈ có ý nghĩa với type='DRAWER', tự cấp
--     (find-or-create) lúc mở ca khi bật "Thủ quỹ riêng".
-- (3) `cashier_shift`: thêm `drawer_account_id` (nullable) — snapshot két riêng gắn với ca này lúc
--     mở, dùng để tự sinh phiếu Chuyển quỹ lúc Chốt ca.

-- AlterTable — cash_voucher.
ALTER TABLE "cash_voucher" ALTER COLUMN "income_expense_type_code" DROP NOT NULL;
ALTER TABLE "cash_voucher" ADD COLUMN "counter_account_id" UUID;
ALTER TABLE "cash_voucher" ADD COLUMN "is_auto_generated" BOOLEAN NOT NULL DEFAULT false;

-- Đúng 1 trong 2 hình dạng: phiếu Thu/Chi thường (không counter_account_id, bắt buộc income_
-- expense_type_code) HOẶC phiếu Chuyển quỹ (có counter_account_id, KHÔNG income_expense_type_code,
-- không tự chuyển cho chính mình).
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_transfer_or_normal_check" CHECK (
  ("counter_account_id" IS NULL AND "income_expense_type_code" IS NOT NULL)
  OR ("counter_account_id" IS NOT NULL AND "income_expense_type_code" IS NULL AND "cash_account_id" <> "counter_account_id")
);

-- CreateIndex — phục vụ Sổ quỹ (GĐ2, tra chứng từ Chuyển quỹ theo quỹ ĐÍCH + khoảng ngày).
CREATE INDEX "cash_voucher_tenant_id_counter_account_id_occurred_at_idx" ON "cash_voucher"("tenant_id", "counter_account_id", "occurred_at");

-- AddForeignKey — composite (tenant_id, counter_account_id) -> cash_account(tenant_id, id), NULLABLE.
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_tenant_id_counter_account_id_fkey" FOREIGN KEY ("tenant_id", "counter_account_id") REFERENCES "cash_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable — cash_account: chủ sở hữu két riêng (Thủ quỹ riêng, GĐ2), chỉ có ý nghĩa type='DRAWER'.
ALTER TABLE "cash_account" ADD COLUMN "owner_user_id" UUID;

CREATE INDEX "cash_account_tenant_id_owner_user_id_idx" ON "cash_account"("tenant_id", "owner_user_id");

-- AddForeignKey — composite (tenant_id, owner_user_id) -> user_account(tenant_id, id), NULLABLE.
ALTER TABLE "cash_account" ADD CONSTRAINT "cash_account_tenant_id_owner_user_id_fkey" FOREIGN KEY ("tenant_id", "owner_user_id") REFERENCES "user_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable — cashier_shift: snapshot két riêng gắn với ca này lúc mở (Thủ quỹ riêng, GĐ2).
ALTER TABLE "cashier_shift" ADD COLUMN "drawer_account_id" UUID;

-- AddForeignKey — composite (tenant_id, drawer_account_id) -> cash_account(tenant_id, id), NULLABLE.
ALTER TABLE "cashier_shift" ADD CONSTRAINT "cashier_shift_tenant_id_drawer_account_id_fkey" FOREIGN KEY ("tenant_id", "drawer_account_id") REFERENCES "cash_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
