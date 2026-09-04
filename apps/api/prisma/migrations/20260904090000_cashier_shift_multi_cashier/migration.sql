-- "Đa thu ngân" — nhiều ca thu ngân chạy song song, tuỳ chọn theo tenant (kế hoạch đã duyệt
-- 2026-09-04, docs/DECISIONS.md). Viết tay (không `prisma migrate diff`), tiếp nối
-- 20260903180000_cashier_shift.
--
-- (1) Nới ràng buộc "chỉ 1 ca OPEN toàn tenant" thành "chỉ 1 ca OPEN/thu ngân" — an toàn với dữ
--     liệu cũ (ràng buộc mới LỎNG HƠN, mọi trạng thái hợp lệ cũ vẫn hợp lệ). Chế độ TẮT (mặc định)
--     vẫn giữ đúng "chỉ 1 ca toàn tenant" nhưng khoá bằng advisory lock ở tầng ứng dụng
--     (CashierShiftService.openShift()), KHÔNG còn dựa vào constraint DB này nữa.
-- (2) payment.cashier_shift_id — cột MỚI thuần cộng thêm, KHÔNG backfill (dòng cũ giữ NULL). Chế
--     độ TẮT không bao giờ đọc cột này (vẫn tính tổng theo khoảng thời gian như cũ); chế độ BẬT
--     dùng cột này để tách đúng phiếu thu của từng thu ngân.

-- DropIndex
DROP INDEX "cashier_shift_one_open_per_tenant";

-- CreateIndex — thay thế, theo TỪNG thu ngân thay vì toàn tenant.
CREATE UNIQUE INDEX "cashier_shift_one_open_per_cashier"
  ON "cashier_shift" ("tenant_id", "cashier_id")
  WHERE "status" = 'OPEN' AND "deleted_at" IS NULL;

-- AlterTable
ALTER TABLE "payment" ADD COLUMN "cashier_shift_id" UUID;

-- CreateIndex — tra cứu tổng kết ca theo `cashier_shift_id` (chế độ đa thu ngân).
CREATE INDEX "payment_tenant_id_cashier_shift_id_idx" ON "payment"("tenant_id", "cashier_shift_id");

-- AddForeignKey — composite (tenant_id, cashier_shift_id): chống trỏ chéo tenant, cùng mẫu payment.invoice_id.
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_cashier_shift_id_fkey" FOREIGN KEY ("tenant_id", "cashier_shift_id") REFERENCES "cashier_shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
