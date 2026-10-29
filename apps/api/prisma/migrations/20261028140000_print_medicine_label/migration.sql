-- "Nhãn thuốc" ở Quản lý mẫu in (docs/DECISIONS.md #267): chứng từ MEDICINE_LABEL + 2 khổ tem mới (50x30 dùng lại giá trị có sẵn của tem ống nghiệm).
-- ALTER TYPE ... ADD VALUE không dùng được giá trị mới trong cùng transaction — migration này chưa có dòng nào dùng giá trị mới.
ALTER TYPE "PrintDocumentType" ADD VALUE 'MEDICINE_LABEL';
ALTER TYPE "PrintPaperSize" ADD VALUE 'LABEL_70X40';
ALTER TYPE "PrintPaperSize" ADD VALUE 'LABEL_60X40';
