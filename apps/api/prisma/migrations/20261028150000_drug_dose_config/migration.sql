-- "Cách kê liều" của thuốc (docs/DECISIONS.md #267): kiểu kê mặc định, đơn vị liều khác đơn vị nhỏ nhất (vd ml cho siro bán nguyên Hộp) + bảng "Liều mẫu".

CREATE TYPE "drug_dose_mode" AS ENUM ('SCHEDULED', 'AS_NEEDED');

ALTER TABLE "drug" ADD COLUMN "dose_mode" "drug_dose_mode" NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE "drug" ADD COLUMN "dose_unit_code" TEXT;
-- NUMERIC có chủ đích: đây là dung tích theo đơn vị liều (không phải tiền), bội của 0,25 như liều của dòng đơn (#241).
ALTER TABLE "drug" ADD COLUMN "dose_per_base_unit" DECIMAL(8,2);

-- Đơn vị liều và dung tích CÙNG có hoặc CÙNG không; dung tích dương và là bội của 0,25.
ALTER TABLE "drug" ADD CONSTRAINT "drug_dose_unit_pair_check" CHECK (
  ("dose_unit_code" IS NULL AND "dose_per_base_unit" IS NULL)
  OR ("dose_unit_code" IS NOT NULL AND "dose_per_base_unit" IS NOT NULL AND "dose_per_base_unit" > 0 AND ("dose_per_base_unit" * 4) = ROUND("dose_per_base_unit" * 4))
);

CREATE TABLE "drug_dose_preset" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "dose_morning" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "dose_noon" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "dose_afternoon" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "dose_evening" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "drug_dose_preset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drug_dose_preset_tenant_id_id_key" ON "drug_dose_preset"("tenant_id", "id");
-- Partial unique — raw SQL, không khai @@unique ở Prisma (cùng lý do drug_unit).
CREATE UNIQUE INDEX "drug_dose_preset_tenant_drug_sort_order_key" ON "drug_dose_preset"("tenant_id", "drug_id", "sort_order") WHERE "deleted_at" IS NULL;

ALTER TABLE "drug_dose_preset" ADD CONSTRAINT "drug_dose_preset_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drug_dose_preset" ADD CONSTRAINT "drug_dose_preset_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drug_dose_preset" ADD CONSTRAINT "drug_dose_preset_version_check" CHECK (version >= 1);
-- Liều mỗi buổi: không âm, bội của 0,25 (như prescription_item), ít nhất một buổi > 0.
ALTER TABLE "drug_dose_preset" ADD CONSTRAINT "drug_dose_preset_dose_check" CHECK (
  dose_morning >= 0 AND dose_noon >= 0 AND dose_afternoon >= 0 AND dose_evening >= 0
  AND (dose_morning * 4) = ROUND(dose_morning * 4) AND (dose_noon * 4) = ROUND(dose_noon * 4)
  AND (dose_afternoon * 4) = ROUND(dose_afternoon * 4) AND (dose_evening * 4) = ROUND(dose_evening * 4)
  AND (dose_morning + dose_noon + dose_afternoon + dose_evening) > 0
);

ALTER TABLE "drug_dose_preset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drug_dose_preset" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "drug_dose_preset"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
