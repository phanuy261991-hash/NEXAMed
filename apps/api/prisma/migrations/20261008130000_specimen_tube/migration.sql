-- Cận lâm sàng — Lấy mẫu xét nghiệm có ống mẫu, mã ống (SID) và tem mã vạch (docs/DECISIONS.md #220).
-- 1 bảng mới THEO TENANT (`specimen_tube`), cột liên kết ở `clinical_order_item`, 2 cột danh mục dùng chung (màu nắp ống, viết tắt nhóm dịch vụ).
-- Đúng khuôn migration GĐ4: 8 cột bắt buộc, RLS, CHECK(version>=1), composite FK cùng tenant.

CREATE TYPE "specimen_tube_status" AS ENUM ('PENDING', 'COLLECTED', 'CANCELLED');
CREATE TYPE "specimen_collect_via" AS ENUM ('SCAN', 'MANUAL');

CREATE TABLE "specimen_tube" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "clinical_order_id" UUID NOT NULL,
    "sid" TEXT NOT NULL,
    "status" "specimen_tube_status" NOT NULL DEFAULT 'PENDING',
    "specimen_type_code" TEXT,
    "specimen_name" TEXT,
    "cap_color" TEXT,
    "print_count" INTEGER NOT NULL DEFAULT 0,
    "last_printed_at" TIMESTAMPTZ(6),
    "last_printed_by" UUID,
    "collected_at" TIMESTAMPTZ(6),
    "collected_by" UUID,
    "collected_via" "specimen_collect_via",
    "cancel_reason" TEXT,
    "replaces_tube_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "specimen_tube_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "specimen_tube_tenant_id_id_key" ON "specimen_tube"("tenant_id", "id");
CREATE UNIQUE INDEX "specimen_tube_tenant_id_sid_key" ON "specimen_tube"("tenant_id", "sid");
CREATE INDEX "specimen_tube_tenant_id_clinical_order_id_idx" ON "specimen_tube"("tenant_id", "clinical_order_id");

ALTER TABLE "specimen_tube" ADD CONSTRAINT "specimen_tube_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "specimen_tube" ADD CONSTRAINT "specimen_tube_tenant_id_clinical_order_id_fkey" FOREIGN KEY ("tenant_id", "clinical_order_id") REFERENCES "clinical_order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "specimen_tube" ADD CONSTRAINT "specimen_tube_tenant_id_replaces_tube_id_fkey" FOREIGN KEY ("tenant_id", "replaces_tube_id") REFERENCES "specimen_tube"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "specimen_tube" ADD CONSTRAINT "specimen_tube_version_check" CHECK (version >= 1);
ALTER TABLE "specimen_tube" ADD CONSTRAINT "specimen_tube_print_count_check" CHECK (print_count >= 0);
-- Ống đã lấy phải có người + giờ + cách xác nhận; ống huỷ phải có lý do.
ALTER TABLE "specimen_tube" ADD CONSTRAINT "specimen_tube_collected_check" CHECK (status <> 'COLLECTED' OR (collected_at IS NOT NULL AND collected_by IS NOT NULL AND collected_via IS NOT NULL));
ALTER TABLE "specimen_tube" ADD CONSTRAINT "specimen_tube_cancel_reason_check" CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL);

ALTER TABLE "specimen_tube" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "specimen_tube"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Dòng chỉ định ↔ ống mẫu đang hiệu lực.
ALTER TABLE "clinical_order_item" ADD COLUMN "specimen_tube_id" UUID;
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_tenant_id_specimen_tube_id_fkey" FOREIGN KEY ("tenant_id", "specimen_tube_id") REFERENCES "specimen_tube"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "clinical_order_item_specimen_tube_idx" ON "clinical_order_item" ("tenant_id", "specimen_tube_id") WHERE "specimen_tube_id" IS NOT NULL;

-- Danh mục dùng chung: màu nắp ống (SPECIMEN_TYPE) và viết tắt in trên tem (TECH_SERVICE_CATEGORY).
ALTER TABLE "reference_catalog" ADD COLUMN "cap_color" TEXT;
ALTER TABLE "reference_catalog" ADD COLUMN "abbreviation" TEXT;
