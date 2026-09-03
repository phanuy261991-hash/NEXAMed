-- Mã tự sinh NGẮN, TUẦN TỰ cho danh mục (docs/DECISIONS.md #113, chủ dự án yêu cầu trực tiếp
-- 2026-09-03) — thay cơ chế ngẫu nhiên cũ (`generateReferenceCatalogCode`/`generateAllergenCode`,
-- dạng "AC-3F9B2A1D", 11-12 ký tự, không theo thứ tự) bằng khuôn `<2 ký tự><5 chữ số>` (vd
-- "HV00001"), sinh theo ĐÚNG thứ tự đã tạo (id là uuidv7, tự sắp theo thời gian tạo).
--
-- Phạm vi CHỈ 6 category `reference_catalog` không có nguồn dữ liệu chính thức để nhập mã tay
-- (ACADEMIC_TITLE/STAFF_POSITION/EMPLOYMENT_STATUS/EMPLOYMENT_TYPE/UNIT/PAYMENT_METHOD) +
-- allergen_group/allergen + work_shift — KHÔNG đụng tới mã nghiệp vụ có tháng-năm (patient_code,
-- encounter_no...) đã chốt riêng ở .claude/docs/data-model.md.
--
-- Đánh số lại TOÀN BỘ mã đã tồn tại (chủ dự án chốt qua AskUserQuestion) — chỉ những dòng ĐÚNG
-- khớp mẫu sinh ngẫu nhiên cũ mới bị đổi (regex '^[A-Z]{2,4}-[0-9A-F]{8}$'), để KHÔNG đụng tới 2
-- mã seed cố định "CASH"/"BANK_TRANSFER" (PAYMENT_METHOD, không qua cơ chế tự sinh) hay bất kỳ mã
-- nào admin có thể đã tự nhập tay trước đây. Vì mã ở các cột tham chiếu khác (không có FK thật,
-- chỉ lưu THẲNG chuỗi — xem comment `ReferenceCatalog`/`ExamTypePrice` trong schema.prisma) nên
-- phải cascade UPDATE đồng thời trong CÙNG migration để không làm lệch dữ liệu đang tham chiếu.

-- 1. Bảng đếm số TOÀN HỆ THỐNG cho danh mục không theo tenant (reference_catalog/allergen_catalog).
CREATE TABLE "global_code_sequence" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "prefix" TEXT NOT NULL,
    "current_value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "global_code_sequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_code_sequence_prefix_key" ON "global_code_sequence"("prefix");

-- 2. Đánh số lại 6 category reference_catalog (toàn hệ thống) + cascade sang mọi cột đang lưu mã
--    cũ dạng chuỗi. Materialize vào bảng tạm để dùng lại (old_code -> new_code) cho cascade.
CREATE TEMP TABLE "_code_remap_reference_catalog" AS
SELECT
  id,
  category,
  code AS old_code,
  (CASE category
    WHEN 'ACADEMIC_TITLE'    THEN 'HV'
    WHEN 'STAFF_POSITION'    THEN 'CD'
    WHEN 'EMPLOYMENT_STATUS' THEN 'TT'
    WHEN 'EMPLOYMENT_TYPE'   THEN 'HL'
    WHEN 'UNIT'              THEN 'DV'
    WHEN 'PAYMENT_METHOD'    THEN 'TM'
  END) || lpad((ROW_NUMBER() OVER (PARTITION BY category ORDER BY id))::text, 5, '0') AS new_code
FROM "reference_catalog"
WHERE category IN ('ACADEMIC_TITLE', 'STAFF_POSITION', 'EMPLOYMENT_STATUS', 'EMPLOYMENT_TYPE', 'UNIT', 'PAYMENT_METHOD')
  AND code ~ '^[A-Z]{2,4}-[0-9A-F]{8}$';

-- 2a. Cascade sang mọi bảng đang lưu THẲNG mã (text, không FK thật) TRƯỚC khi đổi bảng gốc, để
--     WHERE còn khớp được old_code.
UPDATE "user_account" ua SET "academic_title_code" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE cr.category = 'ACADEMIC_TITLE' AND ua."academic_title_code" = cr.old_code;

UPDATE "user_account" ua SET "position_code" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE cr.category = 'STAFF_POSITION' AND ua."position_code" = cr.old_code;

UPDATE "user_account" ua SET "employment_status_code" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE cr.category = 'EMPLOYMENT_STATUS' AND ua."employment_status_code" = cr.old_code;

UPDATE "user_account" ua SET "employment_type_code" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE cr.category = 'EMPLOYMENT_TYPE' AND ua."employment_type_code" = cr.old_code;

UPDATE "exam_type_price" etp SET "unit_code" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE cr.category = 'UNIT' AND etp."unit_code" = cr.old_code;

UPDATE "encounter_service_item" esi SET "unit_code" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE cr.category = 'UNIT' AND esi."unit_code" = cr.old_code;

UPDATE "invoice_line" il SET "unit_code" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE cr.category = 'UNIT' AND il."unit_code" = cr.old_code;

-- encounter.exam_type_unit — DEPRECATED (docs/DECISIONS.md #080), ngừng ghi nhưng dữ liệu cũ vẫn
-- đọc được, cascade cho đúng để không lệch nếu còn nơi nào hiển thị lịch sử.
UPDATE "encounter" e SET "exam_type_unit" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE cr.category = 'UNIT' AND e."exam_type_unit" = cr.old_code;

UPDATE "payment" p SET "method" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE cr.category = 'PAYMENT_METHOD' AND p."method" = cr.old_code;

UPDATE "invoice" inv SET "pending_payment_method" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE cr.category = 'PAYMENT_METHOD' AND inv."pending_payment_method" = cr.old_code;

-- 2b. Đổi mã ở chính bảng gốc.
UPDATE "reference_catalog" rc SET "code" = cr.new_code
FROM "_code_remap_reference_catalog" cr
WHERE rc.id = cr.id;

-- 2c. Khởi tạo current_value cho từng tiền tố = số dòng đã đánh số, để lần tạo mới kế tiếp cấp
--     đúng số tiếp theo (không trùng lại từ 1).
INSERT INTO "global_code_sequence" (prefix, current_value)
SELECT
  (CASE category
    WHEN 'ACADEMIC_TITLE'    THEN 'HV'
    WHEN 'STAFF_POSITION'    THEN 'CD'
    WHEN 'EMPLOYMENT_STATUS' THEN 'TT'
    WHEN 'EMPLOYMENT_TYPE'   THEN 'HL'
    WHEN 'UNIT'              THEN 'DV'
    WHEN 'PAYMENT_METHOD'    THEN 'TM'
  END) AS prefix,
  COUNT(*) AS current_value
FROM "_code_remap_reference_catalog"
GROUP BY category
ON CONFLICT (prefix) DO UPDATE SET current_value = EXCLUDED.current_value;

DROP TABLE "_code_remap_reference_catalog";

-- 3. Đánh số lại allergen_group/allergen — chỉ tham chiếu bởi id (UUID, xem model Allergen), an
--    toàn tuyệt đối, không cần cascade sang bảng nào khác.
WITH renumbered AS (
  SELECT id, 'ND' || lpad((ROW_NUMBER() OVER (ORDER BY id))::text, 5, '0') AS new_code
  FROM "allergen_group"
  WHERE code ~ '^[A-Z]{2,4}-[0-9A-F]{8}$'
)
UPDATE "allergen_group" ag SET code = r.new_code
FROM renumbered r
WHERE ag.id = r.id;

INSERT INTO "global_code_sequence" (prefix, current_value)
SELECT 'ND', COUNT(*) FROM "allergen_group" WHERE code ~ '^ND[0-9]{5}$'
ON CONFLICT (prefix) DO UPDATE SET current_value = EXCLUDED.current_value;

WITH renumbered AS (
  SELECT id, 'DN' || lpad((ROW_NUMBER() OVER (ORDER BY id))::text, 5, '0') AS new_code
  FROM "allergen"
  WHERE code ~ '^[A-Z]{2,4}-[0-9A-F]{8}$'
)
UPDATE "allergen" a SET code = r.new_code
FROM renumbered r
WHERE a.id = r.id;

INSERT INTO "global_code_sequence" (prefix, current_value)
SELECT 'DN', COUNT(*) FROM "allergen" WHERE code ~ '^DN[0-9]{5}$'
ON CONFLICT (prefix) DO UPDATE SET current_value = EXCLUDED.current_value;

-- 4. Đánh số lại work_shift — RIÊNG THEO TENANT (khác 3 nhóm trên, toàn hệ thống), dùng lại
--    code_sequence có sẵn. Chỉ tham chiếu bởi id (work_shift_assignment.work_shift_id, UUID) nên
--    cũng an toàn tuyệt đối, không cần cascade.
WITH renumbered AS (
  SELECT id, tenant_id, 'CA' || lpad((ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id))::text, 5, '0') AS new_code
  FROM "work_shift"
  WHERE code ~ '^[A-Z]{2,4}-[0-9A-F]{8}$'
)
UPDATE "work_shift" ws SET code = r.new_code
FROM renumbered r
WHERE ws.id = r.id;

-- Sentinel UUID cho created_by/updated_by (hành động của migration, không phải actor thật) —
-- đúng quy ước đã dùng ở migration `20260820210000_encounter_virtual_queue` (seed "Khoa chung").
INSERT INTO "code_sequence" (tenant_id, prefix, current_value, created_by, updated_by)
SELECT ws.tenant_id, 'CA', COUNT(*), '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'
FROM "work_shift" ws
WHERE ws.code ~ '^CA[0-9]{5}$'
GROUP BY ws.tenant_id
ON CONFLICT (tenant_id, prefix) DO UPDATE SET current_value = EXCLUDED.current_value, updated_at = now(), version = code_sequence.version + 1;
