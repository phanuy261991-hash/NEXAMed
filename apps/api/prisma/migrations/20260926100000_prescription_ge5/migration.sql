-- Kho Thuốc & Vật tư y tế, Giai đoạn 5 — "Trải nghiệm kê đơn có tồn kho" (docs/product/prd.md mục
-- 4.8, INV-05). Viết tay (không TTY), đúng khuôn mọi migration trước có RLS/GENERATED COLUMN/
-- partial unique index (công cụ diff không biểu diễn được các đối tượng này).

-- ============ drug.shortcut_code — "Gõ tắt tìm thuốc" ============
ALTER TABLE "drug" ADD COLUMN "shortcut_code" TEXT;

-- Partial unique — chỉ cấm trùng gõ tắt giữa các dòng ĐANG hiệu lực, cùng khuôn
-- patient.national_id_hash (C3). Service tự viết thường + trim trước khi lưu.
CREATE UNIQUE INDEX "drug_tenant_id_shortcut_code_key"
  ON "drug" ("tenant_id", "shortcut_code")
  WHERE "shortcut_code" IS NOT NULL AND "deleted_at" IS NULL;

-- ============ drug.search_key — tìm thuốc không dấu ============
-- Tái dùng nguyên hàm nexamed_unaccent_lower() đã tạo ở migration 20260811055006_patient_search_s2_02
-- (đã sửa resolve schema ở 20260901120000_fix_unaccent_search_path) — không định nghĩa lại.
ALTER TABLE "drug"
  ADD COLUMN "search_key" TEXT GENERATED ALWAYS AS (nexamed_unaccent_lower(name)) STORED;

-- GIN kết hợp (tenant_id, search_key) — đúng mẫu patient_tenant_id_search_key_trgm_idx. Extension
-- pg_trgm/btree_gin đã bật từ migration patient_search_s2_02, không cần CREATE EXTENSION lại (cùng
-- cách icd10_catalog tái dùng, không tự khai lại).
CREATE INDEX "drug_tenant_id_search_key_trgm_idx"
  ON "drug" USING GIN ("tenant_id", "search_key" gin_trgm_ops);

-- ============ prescription_template — header "Đơn thuốc mẫu" ============
CREATE TABLE "prescription_template" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "prescription_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prescription_template_tenant_id_id_key" ON "prescription_template"("tenant_id", "id");
CREATE INDEX "prescription_template_tenant_id_idx" ON "prescription_template" ("tenant_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "prescription_template" ADD CONSTRAINT "prescription_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription_template" ADD CONSTRAINT "prescription_template_version_check" CHECK (version >= 1);

ALTER TABLE "prescription_template" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "prescription_template"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ prescription_template_item — dòng thuốc trong mẫu ============
CREATE TABLE "prescription_template_item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "drug_id" UUID NOT NULL,
    "dose" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "duration_days" SMALLINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "instruction" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "prescription_template_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prescription_template_item_tenant_id_id_key" ON "prescription_template_item"("tenant_id", "id");
CREATE INDEX "prescription_template_item_tenant_id_template_id_idx" ON "prescription_template_item" ("tenant_id", "template_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "prescription_template_item" ADD CONSTRAINT "prescription_template_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription_template_item" ADD CONSTRAINT "prescription_template_item_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "prescription_template"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription_template_item" ADD CONSTRAINT "prescription_template_item_tenant_id_drug_id_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription_template_item" ADD CONSTRAINT "prescription_template_item_version_check" CHECK (version >= 1);
ALTER TABLE "prescription_template_item" ADD CONSTRAINT "prescription_template_item_duration_days_check" CHECK (duration_days > 0);
ALTER TABLE "prescription_template_item" ADD CONSTRAINT "prescription_template_item_quantity_check" CHECK (quantity > 0);

ALTER TABLE "prescription_template_item" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "prescription_template_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
