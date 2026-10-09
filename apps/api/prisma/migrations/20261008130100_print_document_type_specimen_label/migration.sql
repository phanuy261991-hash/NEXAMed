-- "Tem mẫu xét nghiệm" ở Quản lý mẫu in (docs/DECISIONS.md #220): chứng từ SPECIMEN_LABEL + 2 khổ tem. Tách file riêng vì ALTER TYPE ... ADD VALUE không dùng được
-- giá trị mới trong cùng transaction (chưa có dòng nào dùng giá trị mới ở migration này).
ALTER TYPE "PrintDocumentType" ADD VALUE 'SPECIMEN_LABEL';
ALTER TYPE "PrintPaperSize" ADD VALUE 'LABEL_35X22';
ALTER TYPE "PrintPaperSize" ADD VALUE 'LABEL_50X30';
