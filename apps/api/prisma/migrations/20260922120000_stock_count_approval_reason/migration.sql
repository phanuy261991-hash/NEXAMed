-- Rà soát lỗ hổng quy trình "Kiểm kê" (22/09/2026, chủ dự án phát hiện: Duyệt phiếu có dư/thiếu tự
-- động sửa tồn kho mà không cần giải trình gì) — thêm cột lưu lý do Duyệt, bắt buộc ở tầng Service
-- (không CHECK constraint ở đây vì "có dòng dư/thiếu" chỉ tính được từ `stock_count_line.difference`
-- ghi SAU khi Duyệt, không tính được thuần bằng SQL CHECK trên chính hàng `stock_count`).
ALTER TABLE "stock_count" ADD COLUMN "approval_reason" TEXT;
