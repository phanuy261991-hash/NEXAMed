-- Backfill "Hãng sản xuất" (docs/DECISIONS.md #151) — chuyển dữ liệu text tự do đã có từ trước
-- (drug.manufacturer, S4-03) thành các dòng danh mục reference_catalog category MANUFACTURER (toàn
-- hệ thống, KHÔNG theo tenant — đúng bản chất reference_catalog hiện có), rồi trỏ drug.
-- manufacturer_code sang đúng dòng tương ứng. Cột manufacturer (text) GIỮ NGUYÊN làm dữ liệu
-- legacy, không xoá. Mỗi giá trị text PHÂN BIỆT HOA/THƯỜNG khác nhau (vd "Pfizer"/"pfizer") sinh 2
-- dòng danh mục riêng biệt — chấp nhận theo đúng quyết định đã chốt (rủi ro trùng nhẹ, ưu tiên đơn
-- giản, `clinic_admin` tự gộp/ẩn qua UI quản lý danh mục nếu cần). Viết tay, môi trường không có TTY.
INSERT INTO "reference_catalog" (id, category, code, name, sort_order, is_active)
SELECT uuidv7(), 'MANUFACTURER', 'MA-' || upper(substr(md5(random()::text || clock_timestamp()::text || name), 1, 8)), name, 0, true
FROM (
  SELECT DISTINCT trim("manufacturer") AS name
  FROM "drug"
  WHERE "manufacturer" IS NOT NULL AND trim("manufacturer") <> ''
) AS distinct_manufacturers;

UPDATE "drug" d
SET "manufacturer_code" = rc.code
FROM "reference_catalog" rc
WHERE rc.category = 'MANUFACTURER'
  AND rc.name = trim(d."manufacturer")
  AND d."manufacturer" IS NOT NULL
  AND trim(d."manufacturer") <> '';
