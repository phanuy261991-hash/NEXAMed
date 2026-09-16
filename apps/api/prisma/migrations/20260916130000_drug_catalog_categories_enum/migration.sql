-- Kho Thuốc & Vật tư y tế — chuyển Dạng bào chế/Điều kiện bảo quản/Hãng sản xuất/Nước sản xuất/
-- Vị trí lưu kho từ nhập tự do sang danh mục có quản lý (docs/DECISIONS.md #151, chủ dự án yêu cầu
-- qua nhiều lượt trong cùng phiên). 5 category mới KHÔNG dùng cùng transaction với dữ liệu backfill
-- (Postgres không cho dùng giá trị enum mới thêm ngay trong cùng transaction) — tách sang migration
-- kế tiếp `20260916140000_drug_manufacturer_catalog_backfill`. Viết tay, môi trường không có TTY.
ALTER TYPE "reference_catalog_category" ADD VALUE 'DOSAGE_FORM';
ALTER TYPE "reference_catalog_category" ADD VALUE 'STORAGE_CONDITION';
ALTER TYPE "reference_catalog_category" ADD VALUE 'MANUFACTURER';
ALTER TYPE "reference_catalog_category" ADD VALUE 'COUNTRY_OF_ORIGIN';
ALTER TYPE "reference_catalog_category" ADD VALUE 'STORAGE_LOCATION';

-- Cột mới trên drug — dosage_form/storage_conditions/country_of_origin ĐÃ CÓ sẵn (migration
-- 20260916120000_drug_extra_fields, khi đó còn là text tự do) — nay đổi Ý NGHĨA thành mã tham
-- chiếu reference_catalog (không đổi kiểu dữ liệu, không cần ALTER COLUMN).
ALTER TABLE "drug" ADD COLUMN "manufacturer_code" TEXT;
ALTER TABLE "drug" ADD COLUMN "storage_location" TEXT;
