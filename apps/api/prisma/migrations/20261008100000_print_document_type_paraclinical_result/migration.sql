-- Cận lâm sàng GĐ4 đợt 2 (docs/DECISIONS.md #214) — thêm chứng từ "Kết quả cận lâm sàng" vào Quản lý mẫu in (#211). Tách file riêng vì
-- ALTER TYPE ... ADD VALUE không dùng được giá trị mới trong cùng transaction.
ALTER TYPE "PrintDocumentType" ADD VALUE 'PARACLINICAL_RESULT';
