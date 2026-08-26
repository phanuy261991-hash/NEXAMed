-- "Chỉ định dịch vụ khám" ở Tiếp nhận — đổi từ 1 dịch vụ/lượt khám sang danh sách nhiều dịch vụ
-- (docs/DECISIONS.md #080). Viết tay (không `prisma migrate diff`) theo đúng khuôn
-- 20260813150000_encounter_vital_sign_reception (RLS + composite FK không dò được bằng diff).
--
-- Không đụng 6 cột exam_type_*/price_type_code/exam_type_unit/service_quantity cũ trên
-- "encounter" — giữ nguyên cho dữ liệu cũ, chỉ đánh dấu deprecated ở schema.prisma.

-- CreateTable
CREATE TABLE "encounter_service_item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "exam_type_code" TEXT NOT NULL,
    "exam_type_name" TEXT NOT NULL,
    "price_type_code" TEXT,
    "unit_code" TEXT,
    "exam_type_price" BIGINT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "encounter_service_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encounter_service_item_tenant_id_id_key" ON "encounter_service_item"("tenant_id", "id");

-- CreateIndex — tra danh sách dịch vụ đã chỉ định theo lượt khám.
CREATE INDEX "encounter_service_item_tenant_id_encounter_id_idx" ON "encounter_service_item" ("tenant_id", "encounter_id");

-- AddForeignKey
ALTER TABLE "encounter_service_item" ADD CONSTRAINT "encounter_service_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, encounter_id): chống trỏ chéo tenant, cùng mẫu vital_sign.
ALTER TABLE "encounter_service_item" ADD CONSTRAINT "encounter_service_item_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "encounter_service_item" ADD CONSTRAINT "encounter_service_item_version_check" CHECK (version >= 1);

-- Row Level Security — cùng mẫu các migration trước. Quyền SELECT/INSERT/UPDATE cơ bản đã tự
-- động cấp cho nexamed_app qua ALTER DEFAULT PRIVILEGES trong migration *_tenant_context.
ALTER TABLE "encounter_service_item" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "encounter_service_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
