-- Cận lâm sàng GĐ3 (docs/DECISIONS.md #212) — thêm chứng từ "Phiếu chỉ định cận lâm sàng" vào Quản lý mẫu in (#211). Tách file riêng vì
-- ALTER TYPE ... ADD VALUE không dùng được giá trị mới trong cùng transaction.
ALTER TYPE "PrintDocumentType" ADD VALUE 'CLINICAL_ORDER';
