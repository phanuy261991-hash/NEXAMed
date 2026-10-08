-- Cận lâm sàng GĐ1 — Danh mục (docs/DECISIONS.md #212). 6 bảng mới THEO TENANT, viết tay (không TTY),
-- đúng khuôn mọi migration trước có RLS / partial unique / exclusion constraint.

CREATE TYPE "technical_service_kind" AS ENUM ('LAB', 'IMAGING', 'FUNCTIONAL');
CREATE TYPE "technical_service_result_type" AS ENUM ('INDICATORS', 'NARRATIVE', 'BOTH');
CREATE TYPE "lab_indicator_value_type" AS ENUM ('NUMBER', 'TEXT', 'CHOICE');
CREATE TYPE "lab_reference_sex" AS ENUM ('ANY', 'MALE', 'FEMALE');

-- ---------------------------------------------------------------------------------------------
-- technical_service
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "technical_service" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "national_code" TEXT,
    "service_kind" "technical_service_kind" NOT NULL,
    "category_code" TEXT,
    "specimen_type_code" TEXT,
    "is_performed_in_house" BOOLEAN NOT NULL DEFAULT true,
    "department_id" UUID,
    "turnaround_minutes" INTEGER,
    "result_type" "technical_service_result_type" NOT NULL DEFAULT 'INDICATORS',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "technical_service_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "technical_service_tenant_id_id_key" ON "technical_service"("tenant_id", "id");
-- Mã hiển thị không trùng trong tenant (bản đã xoá mềm không tính).
CREATE UNIQUE INDEX "technical_service_tenant_code_key" ON "technical_service" ("tenant_id", "code") WHERE "deleted_at" IS NULL;
CREATE INDEX "technical_service_tenant_kind_idx" ON "technical_service" ("tenant_id", "service_kind") WHERE "deleted_at" IS NULL;

ALTER TABLE "technical_service" ADD CONSTRAINT "technical_service_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technical_service" ADD CONSTRAINT "technical_service_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technical_service" ADD CONSTRAINT "technical_service_version_check" CHECK (version >= 1);
ALTER TABLE "technical_service" ADD CONSTRAINT "technical_service_turnaround_check" CHECK (turnaround_minutes IS NULL OR turnaround_minutes > 0);

-- ---------------------------------------------------------------------------------------------
-- technical_service_price — đơn giá đa mức, KHUÔN exam_type_price (C20)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "technical_service_price" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "technical_service_id" UUID NOT NULL,
    "price_type_code" TEXT NOT NULL,
    "unit_code" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "technical_service_price_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "technical_service_price_tenant_id_id_key" ON "technical_service_price"("tenant_id", "id");
CREATE INDEX "technical_service_price_service_idx" ON "technical_service_price" ("tenant_id", "technical_service_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "technical_service_price" ADD CONSTRAINT "technical_service_price_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technical_service_price" ADD CONSTRAINT "technical_service_price_tenant_id_technical_service_id_fkey" FOREIGN KEY ("tenant_id", "technical_service_id") REFERENCES "technical_service"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technical_service_price" ADD CONSTRAINT "technical_service_price_version_check" CHECK (version >= 1);
ALTER TABLE "technical_service_price" ADD CONSTRAINT "technical_service_price_amount_check" CHECK (amount >= 0);
ALTER TABLE "technical_service_price" ADD CONSTRAINT "technical_service_price_range_check" CHECK (effective_to IS NULL OR effective_to >= effective_from);

-- Chặn 2 dòng đơn giá CÙNG dịch vụ + CÙNG Loại giá có khoảng ngày hiệu lực chồng lấn (kể cả 2 request ghi
-- đồng thời). Dùng lại hàm IMMUTABLE nexamed_exam_type_price_range() đã tạo ở migration exam_type_price —
-- cùng ngữ nghĩa ("đến ngày" trống = vô thời hạn), btree_gist đã bật từ trước.
ALTER TABLE "technical_service_price" ADD CONSTRAINT "technical_service_price_no_overlap_excl"
  EXCLUDE USING gist (
    tenant_id WITH =,
    technical_service_id WITH =,
    price_type_code WITH =,
    nexamed_exam_type_price_range(effective_from, effective_to) WITH &&
  )
  WHERE (deleted_at IS NULL);

-- ---------------------------------------------------------------------------------------------
-- lab_indicator
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "lab_indicator" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT,
    "unit" TEXT,
    "value_type" "lab_indicator_value_type" NOT NULL DEFAULT 'NUMBER',
    "decimals" SMALLINT,
    "choice_options" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "lab_indicator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lab_indicator_tenant_id_id_key" ON "lab_indicator"("tenant_id", "id");
CREATE UNIQUE INDEX "lab_indicator_tenant_code_key" ON "lab_indicator" ("tenant_id", "code") WHERE "deleted_at" IS NULL;

ALTER TABLE "lab_indicator" ADD CONSTRAINT "lab_indicator_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_indicator" ADD CONSTRAINT "lab_indicator_version_check" CHECK (version >= 1);
ALTER TABLE "lab_indicator" ADD CONSTRAINT "lab_indicator_decimals_check" CHECK (decimals IS NULL OR (decimals >= 0 AND decimals <= 6));

-- ---------------------------------------------------------------------------------------------
-- lab_indicator_reference
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "lab_indicator_reference" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "indicator_id" UUID NOT NULL,
    "sex" "lab_reference_sex" NOT NULL DEFAULT 'ANY',
    "age_from_years" SMALLINT NOT NULL DEFAULT 0,
    "age_to_years" SMALLINT,
    "low_value" DOUBLE PRECISION,
    "high_value" DOUBLE PRECISION,
    "low_inclusive" BOOLEAN NOT NULL DEFAULT true,
    "high_inclusive" BOOLEAN NOT NULL DEFAULT true,
    "normal_text" TEXT,
    "display_text" TEXT,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "lab_indicator_reference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lab_indicator_reference_tenant_id_id_key" ON "lab_indicator_reference"("tenant_id", "id");
CREATE INDEX "lab_indicator_reference_indicator_idx" ON "lab_indicator_reference" ("tenant_id", "indicator_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "lab_indicator_reference" ADD CONSTRAINT "lab_indicator_reference_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_indicator_reference" ADD CONSTRAINT "lab_indicator_reference_tenant_id_indicator_id_fkey" FOREIGN KEY ("tenant_id", "indicator_id") REFERENCES "lab_indicator"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_indicator_reference" ADD CONSTRAINT "lab_indicator_reference_version_check" CHECK (version >= 1);
ALTER TABLE "lab_indicator_reference" ADD CONSTRAINT "lab_indicator_reference_age_check" CHECK (age_from_years >= 0 AND (age_to_years IS NULL OR age_to_years >= age_from_years));
ALTER TABLE "lab_indicator_reference" ADD CONSTRAINT "lab_indicator_reference_range_check" CHECK (low_value IS NULL OR high_value IS NULL OR low_value <= high_value);

-- ---------------------------------------------------------------------------------------------
-- technical_service_indicator
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "technical_service_indicator" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "technical_service_id" UUID NOT NULL,
    "indicator_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "interpretation_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "technical_service_indicator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "technical_service_indicator_tenant_id_id_key" ON "technical_service_indicator"("tenant_id", "id");
CREATE UNIQUE INDEX "technical_service_indicator_unique_key" ON "technical_service_indicator" ("tenant_id", "technical_service_id", "indicator_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "technical_service_indicator_indicator_idx" ON "technical_service_indicator" ("tenant_id", "indicator_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "technical_service_indicator" ADD CONSTRAINT "technical_service_indicator_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technical_service_indicator" ADD CONSTRAINT "technical_service_indicator_tenant_id_technical_service_id_fkey" FOREIGN KEY ("tenant_id", "technical_service_id") REFERENCES "technical_service"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technical_service_indicator" ADD CONSTRAINT "technical_service_indicator_tenant_id_indicator_id_fkey" FOREIGN KEY ("tenant_id", "indicator_id") REFERENCES "lab_indicator"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technical_service_indicator" ADD CONSTRAINT "technical_service_indicator_version_check" CHECK (version >= 1);

-- ---------------------------------------------------------------------------------------------
-- result_template
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "result_template" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "technical_service_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description_text" TEXT,
    "conclusion_text" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "result_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "result_template_tenant_id_id_key" ON "result_template"("tenant_id", "id");
CREATE INDEX "result_template_service_idx" ON "result_template" ("tenant_id", "technical_service_id") WHERE "deleted_at" IS NULL;
-- Tối đa 1 mẫu mặc định mỗi dịch vụ (đặt mặc định là đổi cờ trong cùng transaction).
CREATE UNIQUE INDEX "result_template_default_key" ON "result_template" ("tenant_id", "technical_service_id") WHERE "is_default" AND "deleted_at" IS NULL;

ALTER TABLE "result_template" ADD CONSTRAINT "result_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_template" ADD CONSTRAINT "result_template_tenant_id_technical_service_id_fkey" FOREIGN KEY ("tenant_id", "technical_service_id") REFERENCES "technical_service"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "result_template" ADD CONSTRAINT "result_template_version_check" CHECK (version >= 1);

-- ---------------------------------------------------------------------------------------------
-- Row Level Security — cùng mẫu mọi bảng tenant khác
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "technical_service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technical_service_price" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_indicator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_indicator_reference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technical_service_indicator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "result_template" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "technical_service"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "technical_service_price"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "lab_indicator"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "lab_indicator_reference"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "technical_service_indicator"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "result_template"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
