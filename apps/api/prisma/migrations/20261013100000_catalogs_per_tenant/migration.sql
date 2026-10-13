-- Danh mục RIÊNG THEO TENANT (docs/DECISIONS.md #230, chủ dự án chốt 13/10/2026): `reference_catalog`, `allergen_group`, `allergen`
-- trước đây dùng chung MỌI tenant (không `tenant_id`) nhưng `clinic_admin` của từng phòng khám sửa được — khi một hệ thống phục vụ
-- nhiều phòng khám (SaaS/máy chủ trung tâm), tenant này thấy và sửa được danh mục của tenant khác. Nay mỗi tenant có BẢN RIÊNG,
-- có `tenant_id` + đủ 8 cột bắt buộc + RLS. Dữ liệu hiện có được SAO CHÉP nguyên (giữ nguyên `code` nên mọi tham chiếu theo mã ở bệnh
-- nhân/thuốc/hoá đơn... vẫn đúng) cho MỌI tenant đang có rồi xoá các dòng dùng chung. Tenant tạo SAU được nạp bản mặc định bằng code
-- (`seedTenantReferenceData`), không còn nạp bằng migration. `global_code_sequence` gộp vào `code_sequence` (theo tenant).
--
-- Forward-only. Chạy bằng role đặc quyền (migrate) nên không bị RLS chặn khi sao chép chéo tenant.

-- ======================================================================================================================
-- 1. reference_catalog
-- ======================================================================================================================
DROP INDEX "reference_catalog_category_code_key";

ALTER TABLE "reference_catalog"
  ADD COLUMN "tenant_id" UUID,
  ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
  ADD COLUMN "deleted_reason" TEXT,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID;

-- Sao chép MỌI dòng dùng chung (tenant_id IS NULL) cho MỌI tenant hiện có.
INSERT INTO "reference_catalog" (
  "id", "tenant_id", "category", "code", "name", "sort_order", "is_active", "price", "unit", "deactivates_account",
  "description", "counts_as_cash", "direction", "byt_code", "full_name", "cap_color", "abbreviation", "version",
  "created_by", "updated_by"
)
SELECT uuidv7(), t."id", r."category", r."code", r."name", r."sort_order", r."is_active", r."price", r."unit", r."deactivates_account",
       r."description", r."counts_as_cash", r."direction", r."byt_code", r."full_name", r."cap_color", r."abbreviation", r."version",
       '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid
FROM "reference_catalog" r
CROSS JOIN "tenant" t
WHERE r."tenant_id" IS NULL;

DELETE FROM "reference_catalog" WHERE "tenant_id" IS NULL;

ALTER TABLE "reference_catalog"
  ALTER COLUMN "tenant_id" SET NOT NULL,
  ALTER COLUMN "created_by" SET NOT NULL,
  ALTER COLUMN "updated_by" SET NOT NULL;

ALTER TABLE "reference_catalog"
  ADD CONSTRAINT "reference_catalog_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "reference_catalog_tenant_id_category_code_key" ON "reference_catalog"("tenant_id", "category", "code");
CREATE UNIQUE INDEX "reference_catalog_tenant_id_id_key" ON "reference_catalog"("tenant_id", "id");

ALTER TABLE "reference_catalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_catalog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reference_catalog"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ======================================================================================================================
-- 2. allergen_group + allergen (+ patient_allergen trỏ lại đúng bản của tenant mình)
-- ======================================================================================================================
DROP INDEX "allergen_group_code_key";
DROP INDEX "allergen_code_key";
ALTER TABLE "allergen" DROP CONSTRAINT "allergen_allergen_group_id_fkey";
ALTER TABLE "patient_allergen" DROP CONSTRAINT "patient_allergen_allergen_id_fkey";

ALTER TABLE "allergen_group"
  ADD COLUMN "tenant_id" UUID,
  ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
  ADD COLUMN "deleted_reason" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID;

ALTER TABLE "allergen"
  ADD COLUMN "tenant_id" UUID,
  ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
  ADD COLUMN "deleted_reason" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID;

-- Bảng ánh xạ id cũ (dùng chung) → id mới của TỪNG tenant, để dựng lại khoá ngoại và sửa `patient_allergen`.
CREATE TEMP TABLE "_allergen_group_map" AS
  SELECT g."id" AS "old_id", t."id" AS "tenant_id", uuidv7() AS "new_id" FROM "allergen_group" g CROSS JOIN "tenant" t WHERE g."tenant_id" IS NULL;
CREATE TEMP TABLE "_allergen_map" AS
  SELECT a."id" AS "old_id", t."id" AS "tenant_id", uuidv7() AS "new_id" FROM "allergen" a CROSS JOIN "tenant" t WHERE a."tenant_id" IS NULL;

INSERT INTO "allergen_group" ("id", "tenant_id", "code", "name", "is_active", "created_by", "updated_by")
SELECT m."new_id", m."tenant_id", g."code", g."name", g."is_active",
       '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid
FROM "_allergen_group_map" m JOIN "allergen_group" g ON g."id" = m."old_id";

INSERT INTO "allergen" ("id", "tenant_id", "allergen_group_id", "code", "name", "is_active", "created_by", "updated_by")
SELECT am."new_id", am."tenant_id", gm."new_id", a."code", a."name", a."is_active",
       '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid
FROM "_allergen_map" am
JOIN "allergen" a ON a."id" = am."old_id"
JOIN "_allergen_group_map" gm ON gm."old_id" = a."allergen_group_id" AND gm."tenant_id" = am."tenant_id";

-- Dị nguyên đã ghi cho bệnh nhân: trỏ sang BẢN CỦA ĐÚNG TENANT (mọi `patient_allergen` đều thuộc một tenant có thật).
UPDATE "patient_allergen" pa
SET "allergen_id" = am."new_id"
FROM "_allergen_map" am
WHERE am."old_id" = pa."allergen_id" AND am."tenant_id" = pa."tenant_id";

DROP TABLE "_allergen_map";
DROP TABLE "_allergen_group_map";

DELETE FROM "allergen" WHERE "tenant_id" IS NULL;
DELETE FROM "allergen_group" WHERE "tenant_id" IS NULL;

ALTER TABLE "allergen_group"
  ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "created_by" SET NOT NULL, ALTER COLUMN "updated_by" SET NOT NULL;
ALTER TABLE "allergen"
  ALTER COLUMN "tenant_id" SET NOT NULL, ALTER COLUMN "created_by" SET NOT NULL, ALTER COLUMN "updated_by" SET NOT NULL;

ALTER TABLE "allergen_group" ADD CONSTRAINT "allergen_group_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allergen" ADD CONSTRAINT "allergen_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allergen_group" ADD CONSTRAINT "allergen_group_version_check" CHECK ("version" >= 1);
ALTER TABLE "allergen" ADD CONSTRAINT "allergen_version_check" CHECK ("version" >= 1);

CREATE UNIQUE INDEX "allergen_group_tenant_id_code_key" ON "allergen_group"("tenant_id", "code");
CREATE UNIQUE INDEX "allergen_group_tenant_id_id_key" ON "allergen_group"("tenant_id", "id");
CREATE UNIQUE INDEX "allergen_tenant_id_code_key" ON "allergen"("tenant_id", "code");
CREATE UNIQUE INDEX "allergen_tenant_id_id_key" ON "allergen"("tenant_id", "id");

-- Khoá ngoại KÉP (tenant_id, ...) — chặn trỏ chéo tenant ở tầng DB (khoá ngoại thường không bị RLS kiểm).
ALTER TABLE "allergen" ADD CONSTRAINT "allergen_tenant_id_allergen_group_id_fkey"
  FOREIGN KEY ("tenant_id", "allergen_group_id") REFERENCES "allergen_group"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_allergen" ADD CONSTRAINT "patient_allergen_tenant_id_allergen_id_fkey"
  FOREIGN KEY ("tenant_id", "allergen_id") REFERENCES "allergen"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allergen_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allergen_group" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "allergen_group"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "allergen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allergen" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "allergen"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ======================================================================================================================
-- 3. global_code_sequence → code_sequence (theo tenant, tiền tố 'CATALOG:' để không đụng mã nghiệp vụ)
-- ======================================================================================================================
INSERT INTO "code_sequence" ("tenant_id", "prefix", "period_key", "current_value", "created_by", "updated_by")
SELECT t."id", 'CATALOG:' || g."prefix", '', g."current_value",
       '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid
FROM "global_code_sequence" g CROSS JOIN "tenant" t
ON CONFLICT ("tenant_id", "prefix", "period_key") DO NOTHING;

DROP TABLE "global_code_sequence";
