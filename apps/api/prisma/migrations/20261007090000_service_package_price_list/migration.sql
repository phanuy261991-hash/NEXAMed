-- Cận lâm sàng GĐ2 — Gói dịch vụ + Bảng giá có thời hạn (docs/DECISIONS.md #212). 4 bảng mới THEO TENANT, viết tay
-- (không TTY), đúng khuôn migration GĐ1: 8 cột bắt buộc, RLS, CHECK(version>=1), partial unique cho mã/dòng trùng.

CREATE TYPE "service_package_pricing_mode" AS ENUM ('FIXED', 'SUM_MINUS_DISCOUNT');
CREATE TYPE "service_package_item_kind" AS ENUM ('EXAM_TYPE', 'TECHNICAL_SERVICE');
CREATE TYPE "price_list_item_kind" AS ENUM ('EXAM_TYPE', 'TECHNICAL_SERVICE', 'PACKAGE', 'DRUG', 'MEDICAL_SUPPLY');
CREATE TYPE "price_list_line_mode" AS ENUM ('PERCENT_OFF', 'NEW_PRICE');

-- ---------------------------------------------------------------------------------------------
-- service_package — gói dịch vụ (Dịch vụ khám + Dịch vụ kỹ thuật, KHÔNG thuốc/vật tư)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "service_package" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pricing_mode" "service_package_pricing_mode" NOT NULL DEFAULT 'FIXED',
    -- Chỉ có nghĩa khi pricing_mode='FIXED'.
    "fixed_price" BIGINT,
    -- Chỉ có nghĩa khi pricing_mode='SUM_MINUS_DISCOUNT' (dùng lại enum chiết khấu của phiếu thu: PERCENT/AMOUNT).
    "discount_type" "invoice_discount_type",
    "discount_value" BIGINT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "service_package_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_package_tenant_id_id_key" ON "service_package"("tenant_id", "id");
CREATE UNIQUE INDEX "service_package_tenant_code_key" ON "service_package" ("tenant_id", "code") WHERE "deleted_at" IS NULL;

ALTER TABLE "service_package" ADD CONSTRAINT "service_package_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_package" ADD CONSTRAINT "service_package_version_check" CHECK (version >= 1);
ALTER TABLE "service_package" ADD CONSTRAINT "service_package_range_check" CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE "service_package" ADD CONSTRAINT "service_package_fixed_price_check" CHECK (fixed_price IS NULL OR fixed_price >= 0);
-- FIXED bắt buộc có giá cố định; SUM_MINUS_DISCOUNT thì chiết khấu đi cặp (loại + giá trị) hoặc không có cả hai.
ALTER TABLE "service_package" ADD CONSTRAINT "service_package_pricing_check" CHECK (
  (pricing_mode = 'FIXED' AND fixed_price IS NOT NULL AND discount_type IS NULL AND discount_value IS NULL)
  OR (pricing_mode = 'SUM_MINUS_DISCOUNT' AND fixed_price IS NULL AND ((discount_type IS NULL AND discount_value IS NULL) OR (discount_type IS NOT NULL AND discount_value IS NOT NULL AND discount_value >= 0)))
);
ALTER TABLE "service_package" ADD CONSTRAINT "service_package_discount_percent_check" CHECK (discount_type IS DISTINCT FROM 'PERCENT' OR discount_value <= 100);

-- ---------------------------------------------------------------------------------------------
-- service_package_item — dịch vụ con của gói. Đúng-1-trong-2 tham chiếu (cùng khuôn invoice_line_source_exactly_one_check)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "service_package_item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "service_package_id" UUID NOT NULL,
    "item_kind" "service_package_item_kind" NOT NULL,
    -- `reference_catalog` category EXAM_TYPE — lưu THẲNG mã (không FK cứng), cùng khuôn exam_type_price.exam_type_code.
    "exam_type_code" TEXT,
    "technical_service_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "service_package_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_package_item_tenant_id_id_key" ON "service_package_item"("tenant_id", "id");
CREATE INDEX "service_package_item_package_idx" ON "service_package_item" ("tenant_id", "service_package_id") WHERE "deleted_at" IS NULL;
-- Cùng 1 dịch vụ không xuất hiện 2 dòng trong 1 gói (muốn nhiều lần thì tăng quantity).
CREATE UNIQUE INDEX "service_package_item_exam_type_key" ON "service_package_item" ("tenant_id", "service_package_id", "exam_type_code") WHERE "deleted_at" IS NULL AND "exam_type_code" IS NOT NULL;
CREATE UNIQUE INDEX "service_package_item_technical_service_key" ON "service_package_item" ("tenant_id", "service_package_id", "technical_service_id") WHERE "deleted_at" IS NULL AND "technical_service_id" IS NOT NULL;
-- Tra "dịch vụ này nằm trong gói nào" (cảnh báo khi ngừng dịch vụ, GĐ3 mở rộng gói).
CREATE INDEX "service_package_item_technical_service_idx" ON "service_package_item" ("tenant_id", "technical_service_id") WHERE "deleted_at" IS NULL AND "technical_service_id" IS NOT NULL;

ALTER TABLE "service_package_item" ADD CONSTRAINT "service_package_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_package_item" ADD CONSTRAINT "service_package_item_tenant_id_service_package_id_fkey" FOREIGN KEY ("tenant_id", "service_package_id") REFERENCES "service_package"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_package_item" ADD CONSTRAINT "service_package_item_tenant_id_technical_service_id_fkey" FOREIGN KEY ("tenant_id", "technical_service_id") REFERENCES "technical_service"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_package_item" ADD CONSTRAINT "service_package_item_version_check" CHECK (version >= 1);
ALTER TABLE "service_package_item" ADD CONSTRAINT "service_package_item_quantity_check" CHECK (quantity >= 1 AND quantity <= 999);
ALTER TABLE "service_package_item" ADD CONSTRAINT "service_package_item_ref_check" CHECK (
  (item_kind = 'EXAM_TYPE' AND exam_type_code IS NOT NULL AND technical_service_id IS NULL)
  OR (item_kind = 'TECHNICAL_SERVICE' AND technical_service_id IS NOT NULL AND exam_type_code IS NULL)
);

-- ---------------------------------------------------------------------------------------------
-- price_list — bảng giá có thời hạn (độ ưu tiên số, CAO THẮNG). "Bảng giá chung" KHÔNG lưu ở đây (= giá nhập trên mặt hàng)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "price_list" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE NOT NULL,
    -- ≥ 1: 0 dành riêng cho Bảng giá chung (giá mặc định trên mặt hàng).
    "priority" INTEGER NOT NULL,
    -- false = "Ngừng bảng giá" (không áp dụng nữa dù còn trong khoảng ngày).
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "price_list_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "price_list_tenant_id_id_key" ON "price_list"("tenant_id", "id");
CREATE UNIQUE INDEX "price_list_tenant_code_key" ON "price_list" ("tenant_id", "code") WHERE "deleted_at" IS NULL;
-- Tra "bảng nào đang hiệu lực vào ngày D" (mỗi lần tính giá).
CREATE INDEX "price_list_effective_idx" ON "price_list" ("tenant_id", "effective_from", "effective_to") WHERE "deleted_at" IS NULL AND "is_active";

ALTER TABLE "price_list" ADD CONSTRAINT "price_list_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_version_check" CHECK (version >= 1);
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_range_check" CHECK (effective_to >= effective_from);
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_priority_check" CHECK (priority >= 1 AND priority <= 999999);

-- ---------------------------------------------------------------------------------------------
-- price_list_item — dòng của bảng giá. item_kind quyết định cột tham chiếu nào được điền (đúng-1-trong-4)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "price_list_item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "item_kind" "price_list_item_kind" NOT NULL,
    "exam_type_code" TEXT,
    "technical_service_id" UUID,
    "service_package_id" UUID,
    "drug_id" UUID,
    -- NULL = mọi Loại giá (dịch vụ khám/kỹ thuật) — chỉ hợp lệ với PERCENT_OFF; NEW_PRICE bắt buộc chỉ định.
    "price_type_code" TEXT,
    -- NULL = mọi bậc đơn vị (thuốc/vật tư) — chỉ hợp lệ với PERCENT_OFF; NEW_PRICE bắt buộc chỉ định.
    "unit_code" TEXT,
    "mode" "price_list_line_mode" NOT NULL,
    -- PERCENT_OFF: % nguyên 1-100. NEW_PRICE: số tiền đồng (>= 0).
    "value" BIGINT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "price_list_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "price_list_item_tenant_id_id_key" ON "price_list_item"("tenant_id", "id");
CREATE INDEX "price_list_item_list_idx" ON "price_list_item" ("tenant_id", "price_list_id") WHERE "deleted_at" IS NULL;
-- Tra "bảng giá nào chứa mặt hàng này" (mỗi lần tính giá + ô "Tra thử giá").
CREATE INDEX "price_list_item_exam_type_idx" ON "price_list_item" ("tenant_id", "exam_type_code") WHERE "deleted_at" IS NULL AND "exam_type_code" IS NOT NULL;
CREATE INDEX "price_list_item_technical_service_idx" ON "price_list_item" ("tenant_id", "technical_service_id") WHERE "deleted_at" IS NULL AND "technical_service_id" IS NOT NULL;
CREATE INDEX "price_list_item_service_package_idx" ON "price_list_item" ("tenant_id", "service_package_id") WHERE "deleted_at" IS NULL AND "service_package_id" IS NOT NULL;
CREATE INDEX "price_list_item_drug_idx" ON "price_list_item" ("tenant_id", "drug_id") WHERE "deleted_at" IS NULL AND "drug_id" IS NOT NULL;
-- Một mặt hàng (kèm đúng phạm vi Loại giá/Đơn vị) chỉ xuất hiện 1 dòng trong 1 bảng giá. COALESCE vì NULL = "mọi ...".
CREATE UNIQUE INDEX "price_list_item_unique_key" ON "price_list_item" (
  "tenant_id", "price_list_id", "item_kind",
  COALESCE("exam_type_code", ''), COALESCE("technical_service_id"::text, ''), COALESCE("service_package_id"::text, ''), COALESCE("drug_id"::text, ''),
  COALESCE("price_type_code", ''), COALESCE("unit_code", '')
) WHERE "deleted_at" IS NULL;

ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_tenant_id_price_list_id_fkey" FOREIGN KEY ("tenant_id", "price_list_id") REFERENCES "price_list"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_tenant_id_technical_service_id_fkey" FOREIGN KEY ("tenant_id", "technical_service_id") REFERENCES "technical_service"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_tenant_id_service_package_id_fkey" FOREIGN KEY ("tenant_id", "service_package_id") REFERENCES "service_package"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_version_check" CHECK (version >= 1);
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_value_check" CHECK (value >= 0 AND (mode <> 'PERCENT_OFF' OR (value >= 1 AND value <= 100)));
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_ref_check" CHECK (
  (item_kind = 'EXAM_TYPE' AND exam_type_code IS NOT NULL AND technical_service_id IS NULL AND service_package_id IS NULL AND drug_id IS NULL)
  OR (item_kind = 'TECHNICAL_SERVICE' AND technical_service_id IS NOT NULL AND exam_type_code IS NULL AND service_package_id IS NULL AND drug_id IS NULL)
  OR (item_kind = 'PACKAGE' AND service_package_id IS NOT NULL AND exam_type_code IS NULL AND technical_service_id IS NULL AND drug_id IS NULL)
  OR (item_kind IN ('DRUG', 'MEDICAL_SUPPLY') AND drug_id IS NOT NULL AND exam_type_code IS NULL AND technical_service_id IS NULL AND service_package_id IS NULL)
);
-- Phạm vi theo loại mặt hàng: Loại giá chỉ cho dịch vụ khám/kỹ thuật; Đơn vị chỉ cho thuốc/vật tư; gói là "trọn gói" (không có cả hai).
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_scope_check" CHECK (
  (item_kind IN ('EXAM_TYPE', 'TECHNICAL_SERVICE') AND unit_code IS NULL)
  OR (item_kind IN ('DRUG', 'MEDICAL_SUPPLY') AND price_type_code IS NULL)
  OR (item_kind = 'PACKAGE' AND price_type_code IS NULL AND unit_code IS NULL)
);
-- "Giá mới" bắt buộc chỉ định đúng Loại giá (dịch vụ) / Đơn vị (thuốc, vật tư); gói không cần.
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_new_price_scope_check" CHECK (
  mode <> 'NEW_PRICE'
  OR (item_kind IN ('EXAM_TYPE', 'TECHNICAL_SERVICE') AND price_type_code IS NOT NULL)
  OR (item_kind IN ('DRUG', 'MEDICAL_SUPPLY') AND unit_code IS NOT NULL)
  OR item_kind = 'PACKAGE'
);
-- "Giảm %" áp cho mọi bậc đơn vị của thuốc/vật tư (đúng mockup: "Giảm % áp cho mọi bậc").
ALTER TABLE "price_list_item" ADD CONSTRAINT "price_list_item_percent_unit_check" CHECK (mode <> 'PERCENT_OFF' OR unit_code IS NULL);

-- ---------------------------------------------------------------------------------------------
-- Row Level Security — cùng mẫu mọi bảng tenant khác
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "service_package" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_package_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_list" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_list_item" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "service_package"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "service_package_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "price_list"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "price_list_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
