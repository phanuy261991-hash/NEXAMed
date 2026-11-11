-- Chi phí vật tư theo dịch vụ (docs/DECISIONS.md #297, giai đoạn 4). Hai phần:
--  (1) `service_consumption_norm` — ĐỊNH MỨC vật tư/thuốc tiêu hao của một dịch vụ (dữ liệu CHUNG cả công ty, không branch_id).
--  (2) `stock_issue` gắn thêm lượt khám + dòng dịch vụ + người thực hiện cho phiếu xuất loại SERVICE_CONSUMPTION (enum đã có từ GĐ3, chưa dùng).
--      Phiếu tiêu hao theo CHI NHÁNH qua kho/lượt khám như mọi phiếu xuất. Viết tay, môi trường không có TTY.

CREATE TABLE "service_consumption_norm" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  -- EXAM_TYPE = dịch vụ khám (mã danh mục EXAM_TYPE); TECHNICAL_SERVICE = dịch vụ kỹ thuật (xét nghiệm/CĐHA/thăm dò).
  "service_kind" TEXT NOT NULL,
  "exam_type_code" TEXT,
  "technical_service_id" UUID,
  "drug_id" UUID NOT NULL,
  -- Theo đơn vị CƠ SỞ của mặt hàng (đúng đơn vị tồn kho theo dõi).
  "quantity" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "service_consumption_norm_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_consumption_norm_version_check" CHECK ("version" >= 1),
  CONSTRAINT "service_consumption_norm_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "service_consumption_norm_kind_check" CHECK (
    ("service_kind" = 'EXAM_TYPE' AND "exam_type_code" IS NOT NULL AND "technical_service_id" IS NULL)
    OR ("service_kind" = 'TECHNICAL_SERVICE' AND "technical_service_id" IS NOT NULL AND "exam_type_code" IS NULL)
  ),
  CONSTRAINT "service_consumption_norm_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "service_consumption_norm_drug_fkey" FOREIGN KEY ("tenant_id", "drug_id") REFERENCES "drug"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "service_consumption_norm_technical_service_fkey" FOREIGN KEY ("tenant_id", "technical_service_id") REFERENCES "technical_service"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "service_consumption_norm_tenant_id_id_key" ON "service_consumption_norm"("tenant_id", "id");
-- Mỗi dịch vụ chỉ một dòng định mức cho mỗi mặt hàng.
CREATE UNIQUE INDEX "service_consumption_norm_exam_uq" ON "service_consumption_norm"("tenant_id", "exam_type_code", "drug_id") WHERE "exam_type_code" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "service_consumption_norm_tech_uq" ON "service_consumption_norm"("tenant_id", "technical_service_id", "drug_id") WHERE "technical_service_id" IS NOT NULL AND "deleted_at" IS NULL;
ALTER TABLE "service_consumption_norm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_consumption_norm" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "service_consumption_norm"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============ stock_issue: phiếu xuất tiêu hao theo dịch vụ ============
ALTER TABLE "stock_issue" ADD COLUMN "encounter_id" UUID;
ALTER TABLE "stock_issue" ADD COLUMN "clinical_order_item_id" UUID;
ALTER TABLE "stock_issue" ADD COLUMN "encounter_service_item_id" UUID;
ALTER TABLE "stock_issue" ADD COLUMN "performed_by" UUID;

ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_encounter_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_clinical_order_item_fkey" FOREIGN KEY ("tenant_id", "clinical_order_item_id") REFERENCES "clinical_order_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_encounter_service_item_fkey" FOREIGN KEY ("tenant_id", "encounter_service_item_id") REFERENCES "encounter_service_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phiếu tiêu hao BẮT BUỘC có lượt khám + đúng MỘT dòng dịch vụ (chỉ định cận lâm sàng HOẶC dịch vụ khám) + người thực hiện; mọi loại khác để trống cả bốn cột.
ALTER TABLE "stock_issue" ADD CONSTRAINT "stock_issue_service_consumption_chk" CHECK (
  (
    "issue_type" = 'SERVICE_CONSUMPTION'
    AND "encounter_id" IS NOT NULL
    AND "performed_by" IS NOT NULL
    AND (("clinical_order_item_id" IS NOT NULL)::int + ("encounter_service_item_id" IS NOT NULL)::int) = 1
  )
  OR (
    "issue_type" <> 'SERVICE_CONSUMPTION'
    AND "encounter_id" IS NULL
    AND "clinical_order_item_id" IS NULL
    AND "encounter_service_item_id" IS NULL
    AND "performed_by" IS NULL
  )
);

-- Mỗi dòng dịch vụ chỉ có MỘT phiếu tiêu hao đang hiệu lực (muốn ghi lại thì đảo phiếu cũ trước).
CREATE UNIQUE INDEX "stock_issue_consumption_order_item_uq" ON "stock_issue"("tenant_id", "clinical_order_item_id") WHERE "clinical_order_item_id" IS NOT NULL AND "status" = 'POSTED' AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "stock_issue_consumption_service_item_uq" ON "stock_issue"("tenant_id", "encounter_service_item_id") WHERE "encounter_service_item_id" IS NOT NULL AND "status" = 'POSTED' AND "deleted_at" IS NULL;
CREATE INDEX "stock_issue_consumption_encounter_idx" ON "stock_issue"("tenant_id", "encounter_id") WHERE "encounter_id" IS NOT NULL;
