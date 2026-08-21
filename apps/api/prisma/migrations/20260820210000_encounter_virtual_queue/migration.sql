-- "Hàng đợi ảo" (docs/DECISIONS.md #064) — encounter.doctor_id trở thành nullable (lượt khám còn
-- trong hàng chờ chung Khoa, chưa được bác sĩ nào nhận), thêm encounter.department_id BẮT BUỘC.
-- Mọi tenant cần có sẵn ít nhất 1 Khoa trước khi department_id có thể NOT NULL — seed "Khoa chung"
-- (is_default=true) cho tenant nào chưa có Khoa mặc định, rồi backfill department_id cho encounter
-- hiện có (ưu tiên Khoa của bác sĩ đã gán, fallback Khoa mặc định) TRƯỚC khi ép NOT NULL. Tenant
-- tạo SAU migration này luôn được `seedDefaultRolesForTenant()` seed Khoa mặc định (xem
-- apps/api/src/infrastructure/persistence/seed-tenant-roles.ts) nên không cần lo backfill lại.

-- 1. Đánh dấu "Khoa chung" tự sinh mỗi tenant — đúng 1 dòng/tenant. Prisma không biểu diễn được
--    unique có điều kiện WHERE (cùng lý do C3 patient.national_id_hash, C14 role.name).
ALTER TABLE "department" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "department_tenant_id_is_default_key"
  ON "department" ("tenant_id")
  WHERE "is_default" = true;

-- 2. Seed "Khoa chung" cho mọi tenant hiện có chưa có Khoa mặc định (dữ liệu dev/test hiện tại).
INSERT INTO "department" (id, tenant_id, name, code, is_default, is_active, created_by, updated_by)
SELECT uuidv7(), t.id, 'Khoa chung', NULL, true, true,
       '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'
FROM "tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "department" d WHERE d.tenant_id = t.id AND d.is_default = true
);

-- 3. Thêm department_id — tạm nullable để backfill trước khi ép NOT NULL.
ALTER TABLE "encounter" ADD COLUMN "department_id" UUID;

-- 4. Backfill: ưu tiên Khoa của bác sĩ đã gán (user_account.department_id), fallback Khoa mặc định
--    của tenant.
UPDATE "encounter" e
SET "department_id" = COALESCE(
  (SELECT ua.department_id FROM "user_account" ua WHERE ua.tenant_id = e.tenant_id AND ua.id = e.doctor_id),
  (SELECT d.id FROM "department" d WHERE d.tenant_id = e.tenant_id AND d.is_default = true)
)
WHERE "department_id" IS NULL;

-- 5. doctor_id → nullable (hàng chờ chung); department_id → bắt buộc (đã backfill xong ở trên).
ALTER TABLE "encounter" ALTER COLUMN "doctor_id" DROP NOT NULL;
ALTER TABLE "encounter" ALTER COLUMN "department_id" SET NOT NULL;

ALTER TABLE "encounter"
  ADD CONSTRAINT "encounter_tenant_id_department_id_fkey"
  FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
