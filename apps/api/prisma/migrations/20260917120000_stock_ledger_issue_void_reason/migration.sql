-- Kho Thuốc GĐ3 (#163) — thiếu reason riêng cho "đảo ngược thẻ kho do huỷ phiếu XUẤT" (chỉ có sẵn
-- RECEIPT_VOID cho phiếu NHẬP, khai từ GĐ2). Tách migration RIÊNG khỏi 20260917110000 — ALTER TYPE
-- ... ADD VALUE không dùng được giá trị mới ngay trong CÙNG migration (bài học đã ghi ở
-- 20260826090000_reference_catalog_unit/20260828090000_encounter_cancel_refund).
ALTER TYPE "stock_ledger_reason" ADD VALUE 'ISSUE_VOID';
