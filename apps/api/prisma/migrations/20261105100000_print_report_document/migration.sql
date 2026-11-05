-- Bản in dùng chung của mọi báo cáo (docs/DECISIONS.md #287): chứng từ REPORT ở Quản lý mẫu in.
-- ALTER TYPE ... ADD VALUE không dùng được giá trị mới trong cùng transaction — migration này chưa có dòng nào dùng giá trị mới.
ALTER TYPE "PrintDocumentType" ADD VALUE 'REPORT';
