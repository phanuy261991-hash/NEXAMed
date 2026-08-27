-- Thu ngân cơ bản (Sprint 5/6, BIL-01→04, docs/DECISIONS.md #072/#080/#084) — module `billing` mới.
-- Viết tay (không `prisma migrate diff`) theo đúng khuôn 20260826110000_encounter_service_item
-- (RLS + composite FK không dò được bằng diff).
--
-- (1) "encounter.allows_deferred_payment" — ý nghĩa thật của checkbox "Thanh toán sau" ở Tiếp
--     nhận (#080), gate "Hàng đợi khám" theo thanh toán (EncounterService.startConsultation +
--     EncounterRepository.listForDay). Mặc định false — an toàn cho dữ liệu cũ.
-- (2) 3 bảng invoice/invoice_line/payment — đúng khuôn 8 cột bắt buộc + RLS + composite FK
--     (tenant_id, x_id) chống trỏ chéo tenant đã dùng cho encounter_service_item/prescription.

-- AlterTable
ALTER TABLE "encounter" ADD COLUMN "allows_deferred_payment" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('UNPAID', 'PAID');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'BANK_TRANSFER');

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'UNPAID',
    "total_amount" BIGINT NOT NULL,
    "printed_at" TIMESTAMPTZ(6),
    "pending_payment_method" "payment_method",
    "pending_cash_received_amount" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenant_id_id_key" ON "invoice"("tenant_id", "id");

-- CreateIndex — đúng 1 phiếu thu/lượt khám (BIL-01), cũng phục vụ tra invoice theo encounter_id.
CREATE UNIQUE INDEX "invoice_tenant_id_encounter_id_key" ON "invoice"("tenant_id", "encounter_id");

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, encounter_id): chống trỏ chéo tenant, cùng mẫu encounter_service_item.
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_version_check" CHECK (version >= 1);

ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "invoice"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "source_service_item_id" UUID NOT NULL,
    "exam_type_code" TEXT NOT NULL,
    "exam_type_name" TEXT NOT NULL,
    "price_type_code" TEXT,
    "unit_code" TEXT,
    "unit_price" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_line_tenant_id_id_key" ON "invoice_line"("tenant_id", "id");

-- CreateIndex — tra danh sách dòng theo phiếu thu (in phiếu, xem chi tiết).
CREATE INDEX "invoice_line_tenant_id_invoice_id_idx" ON "invoice_line"("tenant_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, invoice_id): chống trỏ chéo tenant.
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoice"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, source_service_item_id): biết nguồn gốc dòng, chống trỏ chéo tenant.
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_source_service_item_id_fkey" FOREIGN KEY ("tenant_id", "source_service_item_id") REFERENCES "encounter_service_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_version_check" CHECK (version >= 1);

ALTER TABLE "invoice_line" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "invoice_line"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount" BIGINT NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_tenant_id_id_key" ON "payment"("tenant_id", "id");

-- CreateIndex — tra lịch sử thu theo phiếu thu (revert/audit).
CREATE INDEX "payment_tenant_id_invoice_id_idx" ON "payment"("tenant_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — composite (tenant_id, invoice_id): chống trỏ chéo tenant.
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoice"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "payment" ADD CONSTRAINT "payment_version_check" CHECK (version >= 1);

ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "payment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
