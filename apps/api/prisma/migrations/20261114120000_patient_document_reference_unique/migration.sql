-- Giai đoạn 2 của tab "Hình ảnh & Tài liệu" (docs/DECISIONS.md #299 bổ sung 3): dòng THAM CHIẾU chỉ đọc (kết quả cận lâm sàng, thẻ BHYT, ảnh đại diện) được máy chủ tự đối chiếu với nguồn
-- mỗi lần mở tab, nên hai lần mở đồng thời có thể cùng thêm một dòng. Chỉ mục này mỗi tệp gốc (cùng khoá lưu) chỉ có MỘT dòng tham chiếu chưa xoá mềm trong cùng bệnh nhân —
-- một PDF của đối tác gắn cho nhiều dịch vụ của cùng một bệnh nhân vẫn chỉ hiện một dòng. Tệp tải tay (UPLOAD) không áp dụng: khoá lưu của chúng luôn là UUID mới.
CREATE UNIQUE INDEX "patient_document_reference_key" ON "patient_document"("tenant_id", "patient_id", "storage_key") WHERE "deleted_at" IS NULL AND "source_type" <> 'UPLOAD';
