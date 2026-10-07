-- Tách mẫu in "Kết quả cận lâm sàng" thành 2 chứng từ riêng (docs/DECISIONS.md #215): "Kết quả xét nghiệm" (LAB_RESULT) và "Kết quả CĐHA & Thăm dò chức năng"
-- (IMAGING_RESULT) vì bố cục khác nhau. Tách file riêng vì ALTER TYPE ... ADD VALUE không dùng được giá trị mới trong cùng transaction — việc chuyển bản mẫu cũ nằm ở migration kế tiếp.
ALTER TYPE "PrintDocumentType" ADD VALUE 'LAB_RESULT';
ALTER TYPE "PrintDocumentType" ADD VALUE 'IMAGING_RESULT';
