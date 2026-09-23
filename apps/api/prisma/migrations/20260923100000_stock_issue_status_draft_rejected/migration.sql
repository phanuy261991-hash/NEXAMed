-- Kho Thuốc GĐ4, phần "Phiếu xuất kho mở rộng" (docs/DECISIONS.md #170, kế hoạch kỹ thuật
-- bright-bubbling-axolotl.md mục 4, mockup đã duyệt) — mở khoá luồng Nháp→Duyệt cho 3 loại phiếu
-- xuất mới (Xuất dùng nội bộ/Xuất trả nhà cung cấp/Xuất huỷ). `RETAIL_SALE` (Phát thuốc, GĐ3) GIỮ
-- NGUYÊN 1 bước, không đổi. Tách RIÊNG migration này — `ALTER TYPE ... ADD VALUE` không dùng được
-- giá trị mới ngay trong CÙNG transaction/migration (bài học đã ghi ở
-- 20260917120000_stock_ledger_issue_void_reason).
ALTER TYPE "stock_issue_status" ADD VALUE 'DRAFT';
ALTER TYPE "stock_issue_status" ADD VALUE 'REJECTED';
