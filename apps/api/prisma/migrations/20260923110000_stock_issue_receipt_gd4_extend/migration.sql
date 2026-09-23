-- Kho Thuốc GĐ4 — "Phiếu xuất kho mở rộng" (approved/rejection/department_id, cột `stock_issue_status`
-- đã có DRAFT/REJECTED từ migration trước) + "Phiếu nhập kho mở rộng" (Chiết khấu Toàn phiếu/Từng
-- dòng — tái dùng enum "invoice_discount_type" có sẵn từ Thu ngân #137, KHÔNG tạo enum riêng;
-- RETURN_FROM_USE mở khoá thuần ở tầng code, không cần cột mới). docs/DECISIONS.md #170, kế hoạch
-- kỹ thuật bright-bubbling-axolotl.md mục 3+4, mockup đã duyệt.

-- ============ stock_issue — Nháp→Duyệt cho 3 loại phiếu xuất mới ============
ALTER TABLE "stock_issue" ADD COLUMN "approved_by" UUID;
ALTER TABLE "stock_issue" ADD COLUMN "approved_at" TIMESTAMPTZ(6);
ALTER TABLE "stock_issue" ADD COLUMN "rejection_reason" TEXT;
-- Khoa/Phòng TIẾP NHẬN — CHỈ có ý nghĩa với issue_type='INTERNAL_ALLOCATION'. Bắt buộc ở tầng Zod/
-- Service (không CHECK DB "IS NOT NULL" — cùng cách xử lý batch_no bắt buộc-nếu-quản-lý-theo-lô đã
-- có), chỉ CHECK chiều ngược lại (loại khác PHẢI NULL) ở dưới.
ALTER TABLE "stock_issue" ADD COLUMN "department_id" UUID;

-- rejection_reason bắt buộc khi REJECTED, NULL trạng thái khác — cùng mẫu stock_transfer/stock_count.
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_rejection_reason_check" CHECK (
  ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL)
  OR ("status" != 'REJECTED' AND "rejection_reason" IS NULL)
);
-- department_id chỉ có ý nghĩa với INTERNAL_ALLOCATION — mọi loại khác PHẢI NULL.
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_department_id_check" CHECK (
  "issue_type" = 'INTERNAL_ALLOCATION' OR "department_id" IS NULL
);

CREATE INDEX "stock_issue_tenant_id_department_id_idx" ON "stock_issue"("tenant_id", "department_id");
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============ stock_receipt — Chiết khấu (CHỈ receiptType='PURCHASE', ép ở tầng Service — cùng
-- cách invoice/invoice_line không CHECK DB, chỉ tầng Service) ============
ALTER TABLE "stock_receipt" ADD COLUMN "discount_type" "invoice_discount_type";
ALTER TABLE "stock_receipt" ADD COLUMN "discount_value" BIGINT;
ALTER TABLE "stock_receipt" ADD COLUMN "discount_reason" TEXT;

ALTER TABLE "stock_receipt_line" ADD COLUMN "discount_type" "invoice_discount_type";
ALTER TABLE "stock_receipt_line" ADD COLUMN "discount_value" BIGINT;
