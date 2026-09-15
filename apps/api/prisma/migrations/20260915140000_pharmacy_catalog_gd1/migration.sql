-- Kho Thuốc & Vật tư y tế, Giai đoạn 1 (docs/DECISIONS.md #146) — mở rộng `drug` sẵn có (Sprint 4,
-- S4-03) + 4 bảng MỚI (`drug_unit`/`drug_ingredient`/`supplier`/`warehouse`) + 3 category
-- `reference_catalog` mới (ACTIVE_INGREDIENT/DRUG_GROUP/DRUG_ROUTE). Viết tay (không `prisma
-- migrate dev` — môi trường không có TTY, cùng cách `20260909110000_invoice_discount`).

-- ============ Drug: item_type + các cột mới ============
CREATE TYPE "drug_item_type" AS ENUM ('MEDICINE', 'SUPPLY');

ALTER TABLE "drug" ADD COLUMN "item_type" "drug_item_type" NOT NULL DEFAULT 'MEDICINE';
ALTER TABLE "drug" ADD COLUMN "is_batch_managed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "drug" ADD COLUMN "base_unit_code" TEXT;
ALTER TABLE "drug" ADD COLUMN "default_sell_price" BIGINT;
ALTER TABLE "drug" ADD COLUMN "drug_group_code" TEXT;
ALTER TABLE "drug" ADD COLUMN "route_code" TEXT;
ALTER TABLE "drug" ADD COLUMN "national_code" TEXT;
ALTER TABLE "drug" ADD COLUMN "manufacturer" TEXT;
ALTER TABLE "drug" ADD COLUMN "min_stock_alert" INTEGER;
ALTER TABLE "drug" ADD COLUMN "max_stock_alert" INTEGER;

-- ============ drug_unit — chuỗi quy đổi đơn vị N bậc ============
CREATE TABLE "drug_unit" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "unit_code" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "factor_to_unit_below" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "drug_unit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drug_unit_tenant_id_id_key" ON "drug_unit"("tenant_id", "id");
-- Partial unique — raw SQL, không khai @@unique ở Prisma (cùng lý do patient.national_id_hash).
CREATE UNIQUE INDEX "drug_unit_tenant_drug_sort_order_key" ON "drug_unit"("tenant_id", "drug_id", "sort_order") WHERE "deleted_at" IS NULL;

ALTER TABLE "drug_unit" ADD CONSTRAINT "drug_unit_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drug_unit" ADD CONSTRAINT "drug_unit_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drug_unit" ADD CONSTRAINT "drug_unit_version_check" CHECK (version >= 1);

ALTER TABLE "drug_unit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "drug_unit"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ drug_ingredient — hoạt chất & hàm lượng ============
CREATE TABLE "drug_ingredient" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "active_ingredient_code" TEXT NOT NULL,
    "strength_value" INTEGER NOT NULL,
    "strength_unit_code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "drug_ingredient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drug_ingredient_tenant_id_id_key" ON "drug_ingredient"("tenant_id", "id");
CREATE UNIQUE INDEX "drug_ingredient_tenant_drug_code_key" ON "drug_ingredient"("tenant_id", "drug_id", "active_ingredient_code") WHERE "deleted_at" IS NULL;

ALTER TABLE "drug_ingredient" ADD CONSTRAINT "drug_ingredient_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drug_ingredient" ADD CONSTRAINT "drug_ingredient_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "drug_ingredient" ADD CONSTRAINT "drug_ingredient_version_check" CHECK (version >= 1);
ALTER TABLE "drug_ingredient" ADD CONSTRAINT "drug_ingredient_strength_value_check" CHECK (strength_value >= 0);

ALTER TABLE "drug_ingredient" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "drug_ingredient"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ supplier — Nhà cung cấp ============
CREATE TABLE "supplier" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_code" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "contact_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_tenant_id_id_key" ON "supplier"("tenant_id", "id");
CREATE UNIQUE INDEX "supplier_tenant_id_code_key" ON "supplier"("tenant_id", "code");

ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_version_check" CHECK (version >= 1);

ALTER TABLE "supplier" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ warehouse — Kho ============
CREATE TABLE "warehouse" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "department_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouse_tenant_id_id_key" ON "warehouse"("tenant_id", "id");
CREATE UNIQUE INDEX "warehouse_tenant_id_code_key" ON "warehouse"("tenant_id", "code");
-- Đúng 1 kho mặc định/tenant — partial unique, cùng khuôn department.is_default (#064).
CREATE UNIQUE INDEX "warehouse_tenant_id_default_key" ON "warehouse"("tenant_id") WHERE "is_default" AND "deleted_at" IS NULL;

ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_version_check" CHECK (version >= 1);

ALTER TABLE "warehouse" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "warehouse"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ reference_catalog: 3 category mới ============
-- ALTER TYPE ... ADD VALUE không dùng giá trị mới ngay trong CÙNG migration này (không INSERT/seed
-- nào tham chiếu 3 giá trị này ở đây) nên an toàn chạy trong 1 transaction — cùng lý do đã ghi ở
-- 20260826090000_reference_catalog_unit / 20260905090000_reference_catalog_income_expense_type.
ALTER TYPE "reference_catalog_category" ADD VALUE 'ACTIVE_INGREDIENT';
ALTER TYPE "reference_catalog_category" ADD VALUE 'DRUG_GROUP';
ALTER TYPE "reference_catalog_category" ADD VALUE 'DRUG_ROUTE';
