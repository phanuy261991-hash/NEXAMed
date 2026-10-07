-- Cận lâm sàng GĐ3 (docs/DECISIONS.md #212) — hoá đơn "Cận lâm sàng" riêng khi hoá đơn khám đã thu. Tách file riêng khỏi migration tạo bảng vì
-- ALTER TYPE ... ADD VALUE không dùng được giá trị mới trong cùng transaction (cùng lý do các migration *_reference_catalog_* trước).
ALTER TYPE "invoice_type" ADD VALUE 'PARACLINICAL';
