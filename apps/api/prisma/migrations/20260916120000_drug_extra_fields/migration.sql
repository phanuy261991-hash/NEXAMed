-- Kho Thuốc & Vật tư y tế — bổ sung thêm các trường Thuốc theo rà soát chi tiết tài liệu quy chuẩn
-- (docs/DECISIONS.md #151, chủ dự án xác nhận từng trường qua nhiều lượt trong cùng phiên). Tất cả
-- CHỈ có ý nghĩa với itemType='MEDICINE' — VTYT giữ nguyên hoãn, không mở rộng field cho SUPPLY.
-- Viết tay, môi trường không có TTY (cùng cách 20260915140000/20260916090000/20260916100000).
ALTER TABLE "drug" ADD COLUMN "registration_number" TEXT;
ALTER TABLE "drug" ADD COLUMN "dosage_form" TEXT;
ALTER TABLE "drug" ADD COLUMN "country_of_origin" TEXT;
ALTER TABLE "drug" ADD COLUMN "default_dosage" TEXT;
ALTER TABLE "drug" ADD COLUMN "usage_instruction" TEXT;
ALTER TABLE "drug" ADD COLUMN "contraindications" TEXT;
ALTER TABLE "drug" ADD COLUMN "storage_conditions" TEXT;
ALTER TABLE "drug" ADD COLUMN "barcode" TEXT;
