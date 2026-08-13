-- Sprint 3, phần Tiếp nhận — thiết kế lại theo góp ý chủ dự án (3 vòng, xem docs/DECISIONS.md):
-- (1) "Tiếp nhận bệnh nhân" tạo thẳng encounter, KHÔNG qua appointment; (2) 2 danh mục mới quản
-- lý ở Cấu hình — Nguồn khách hàng / Loại khám, tái dùng reference_catalog thay vì bảng riêng.
--
-- ALTER TYPE ... ADD VALUE không dùng giá trị mới ngay trong CÙNG migration này (chỉ thêm giá
-- trị enum, không insert/update dòng nào dùng nó) nên an toàn chạy trong 1 transaction.

ALTER TYPE "reference_catalog_category" ADD VALUE 'PATIENT_SOURCE';
ALTER TYPE "reference_catalog_category" ADD VALUE 'EXAM_TYPE';

-- Giá tham khảo (đồng) — chỉ có ý nghĩa với category EXAM_TYPE, NULL với category khác. v1 chỉ
-- lưu để hiển thị, không tính toán/xuất hoá đơn (viện phí ngoài phạm vi CLAUDE.md).
ALTER TABLE "reference_catalog" ADD COLUMN "price" BIGINT;

-- "Tiếp nhận bệnh nhân" — mã danh mục PATIENT_SOURCE đã chọn, tuỳ chọn (cùng convention
-- patient.ethnicity: lưu code, không lưu tên).
ALTER TABLE "encounter" ADD COLUMN "patient_source_code" TEXT;

-- SNAPSHOT loại khám (category EXAM_TYPE) tại thời điểm tạo encounter — copy tên+giá từ
-- reference_catalog lúc chọn trên web, không JOIN lại lúc đọc (cùng tinh thần
-- insurance_snapshot: đổi giá/tên danh mục sau này không ảnh hồ sơ cũ). NULL khi encounter tạo
-- qua check-in từ lịch hẹn có sẵn (không có loại khám ở luồng đó).
ALTER TABLE "encounter" ADD COLUMN "exam_type_code" TEXT;
ALTER TABLE "encounter" ADD COLUMN "exam_type_name" TEXT;
ALTER TABLE "encounter" ADD COLUMN "exam_type_price" BIGINT;
