-- "Nhập hoàn trả từ bệnh nhân/khoa phòng" (stock_receipt.receiptType='RETURN_FROM_USE', GĐ4 #170) —
-- chủ dự án hỏi có bắt chọn phiếu xuất/đơn thuốc gốc hay không, xác nhận muốn giữ KHÔNG BẮT BUỘC
-- (sợ trường hợp không tìm ra phiếu xuất gốc thì không trả được hàng vào kho). Thêm liên kết TUỲ
-- CHỌN tới "Phiếu xuất kho" gốc (`stock_issue` — bao gồm cả RETAIL_SALE gắn đơn thuốc lẫn
-- INTERNAL_ALLOCATION gắn Khoa/Phòng, đúng 2 nguồn "bệnh nhân"/"khoa phòng" nêu trong tên loại phiếu)
-- để có dấu vết truy nguyên KHI người dùng tìm thấy, nhưng KHÔNG chặn lập phiếu khi không chọn —
-- cùng khuôn lỏng `stock_issue.sourceReceiptId` (RETURN_TO_SUPPLIER, 20260924110000_supplier_debt_phase_c).

ALTER TABLE "stock_receipt" ADD COLUMN "source_issue_id" UUID;

-- source_issue_id chỉ có ý nghĩa với RETURN_FROM_USE — mọi loại khác PHẢI NULL (ép ở tầng Service,
-- không CHECK "bắt buộc NOT NULL" cho RETURN_FROM_USE vì trường này TUỲ CHỌN, đúng yêu cầu).
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_source_issue_id_check" CHECK (
  "receipt_type" = 'RETURN_FROM_USE' OR "source_issue_id" IS NULL
);

CREATE INDEX "stock_receipt_tenant_id_source_issue_id_idx" ON "stock_receipt"("tenant_id", "source_issue_id");

ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_tenant_id_source_issue_id_fkey" FOREIGN KEY ("tenant_id", "source_issue_id") REFERENCES "stock_issue"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
