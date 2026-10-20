-- Liên thông đơn thuốc quốc gia, GĐ3 (docs/DECISIONS.md #242, mockup 8b): danh mục "Hình thức điều trị" (bắt buộc với đơn loại C khi gửi lên cổng).
-- `code` = MÃ SỐ do Bộ Y tế ban hành (cổng nhận giá trị số), nhập tay; `name` = tên hiển thị. KHÔNG seed cứng: chưa có file danh mục chính thức của Bộ Y tế
-- (đang chờ từ đơn vị vận hành cổng), phòng khám tự thêm mục. Postgres không cho dùng giá trị enum mới trong cùng transaction với ADD VALUE nên giá trị này
-- được dùng từ migration sau/ứng dụng. Viết tay, môi trường không có TTY.
ALTER TYPE "reference_catalog_category" ADD VALUE 'TREATMENT_FORM';
