-- Giai đoạn 3 của tab "Hình ảnh & Tài liệu" (docs/DECISIONS.md #299 bổ sung 4): ảnh thu nhỏ do TRÌNH DUYỆT tạo lúc tải lên (canvas, JPEG ~vài chục KB) và gửi kèm tệp,
-- máy chủ chỉ lưu cạnh tệp gốc. Cột chỉ có giá trị với tệp tải tay là ảnh; dòng tham chiếu và tệp cũ để trống (giao diện rơi về ảnh gốc).
ALTER TABLE "patient_document" ADD COLUMN "thumbnail_key" TEXT;
