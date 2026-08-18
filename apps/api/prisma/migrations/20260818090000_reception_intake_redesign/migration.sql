-- Thiết kế lại "Tiếp nhận bệnh nhân" theo mockup đã chủ dự án duyệt (Artifact, nhiều vòng chỉnh) —
-- thêm Loại tiếp nhận/Hình thức khám/Ưu tiên khám/Lý do ưu tiên; Chỉ định dịch vụ khám (Loại giá
-- dịch vụ, Đơn vị, Số lượng) chỉ lưu để hiển thị, KHÔNG tính viện phí/xuất hoá đơn (ngoài phạm vi
-- v1, CLAUDE.md).
--
-- ALTER TYPE ... ADD VALUE không dùng giá trị mới ngay trong CÙNG migration này (chỉ thêm giá trị
-- enum, không insert/update dòng nào dùng nó) nên an toàn chạy trong 1 transaction — cùng cách
-- migration 20260813160000_reception_direct_and_catalog_extension.
ALTER TYPE "reference_catalog_category" ADD VALUE 'RECEPTION_TYPE';
ALTER TYPE "reference_catalog_category" ADD VALUE 'EXAM_FORM';
ALTER TYPE "reference_catalog_category" ADD VALUE 'PRIORITY_REASON';
ALTER TYPE "reference_catalog_category" ADD VALUE 'PRICE_TYPE';

-- Đơn vị (ví dụ "Lượt", "Buổi") — chỉ có ý nghĩa với category EXAM_TYPE, NULL với category khác,
-- cùng khuôn cột "price" đã có.
ALTER TABLE "reference_catalog" ADD COLUMN "unit" TEXT;

-- Mở rộng "Thông tin tiếp nhận" trên encounter — tất cả nullable/có default an toàn, áp dụng dần
-- cho encounter mới, không phá dữ liệu cũ đã tạo trước khi có các cột này.
ALTER TABLE "encounter" ADD COLUMN "reception_type_code" TEXT;
ALTER TABLE "encounter" ADD COLUMN "exam_form_code" TEXT;
ALTER TABLE "encounter" ADD COLUMN "is_priority" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "encounter" ADD COLUMN "priority_reason_code" TEXT;

-- "Chỉ định dịch vụ khám" — Loại giá dịch vụ (PRICE_TYPE, tuỳ chọn, chỉ ghi chú) + Đơn vị/Số lượng
-- SNAPSHOT tại thời điểm tạo (cùng tinh thần exam_type_code/name/price) — chỉ lưu để hiển thị,
-- KHÔNG tính viện phí/xuất hoá đơn.
ALTER TABLE "encounter" ADD COLUMN "price_type_code" TEXT;
ALTER TABLE "encounter" ADD COLUMN "exam_type_unit" TEXT;
ALTER TABLE "encounter" ADD COLUMN "service_quantity" INTEGER NOT NULL DEFAULT 1;