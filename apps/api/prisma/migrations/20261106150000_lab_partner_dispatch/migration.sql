-- "Gửi mẫu đối tác" giai đoạn 2 (docs/DECISIONS.md #291): đợt gửi mẫu + dòng gửi.
-- `lab_partner_dispatch` = MỘT đợt gửi cho MỘT đối tác (nhà cung cấp có cờ đối tác), THEO CHI NHÁNH (nơi lấy/gửi mẫu), mã `GM…` cấp qua BusinessCodeService.
-- `lab_partner_dispatch_item` = MỘT dịch vụ trong đợt: CHỤP LẠI giá trả (`unit_cost`) lúc gửi mẫu (đổi giá sau không làm lệch), hạn trả `due_at` = giờ gửi + thời gian trả kết quả của dịch vụ.
-- Trạng thái dòng: SENT (đã gửi, chờ kết quả) → RECEIVED (đã nhận kết quả, ghi nợ) | REJECTED (đối tác không nhận — mẫu về "Chờ gửi", giữ lịch sử, 0 đ). Một dòng chỉ định có tối đa MỘT dòng gửi
-- đang hiệu lực (SENT/RECEIVED); các lần gửi bị từ chối còn lại làm lịch sử.

CREATE TYPE "lab_partner_dispatch_item_status" AS ENUM ('SENT', 'RECEIVED', 'REJECTED');

CREATE TABLE "lab_partner_dispatch" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "dispatch_no" TEXT NOT NULL,
  "supplier_id" UUID NOT NULL,
  "sent_at" TIMESTAMPTZ(6) NOT NULL,
  "sent_by" UUID NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "lab_partner_dispatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lab_partner_dispatch_version_check" CHECK ("version" >= 1),
  CONSTRAINT "lab_partner_dispatch_note_check" CHECK ("note" IS NULL OR char_length("note") <= 1000),
  CONSTRAINT "lab_partner_dispatch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_partner_dispatch_branch_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_partner_dispatch_supplier_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lab_partner_dispatch_tenant_id_id_key" ON "lab_partner_dispatch"("tenant_id", "id");
CREATE UNIQUE INDEX "lab_partner_dispatch_dispatch_no_key" ON "lab_partner_dispatch"("tenant_id", "dispatch_no");
CREATE INDEX "lab_partner_dispatch_branch_sent_idx" ON "lab_partner_dispatch"("tenant_id", "branch_id", "sent_at" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "lab_partner_dispatch_supplier_idx" ON "lab_partner_dispatch"("tenant_id", "supplier_id", "sent_at" DESC) WHERE "deleted_at" IS NULL;

CREATE TABLE "lab_partner_dispatch_item" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "dispatch_id" UUID NOT NULL,
  "clinical_order_item_id" UUID NOT NULL,
  "specimen_tube_id" UUID,
  "unit_cost" BIGINT NOT NULL,
  "due_at" TIMESTAMPTZ(6),
  "status" "lab_partner_dispatch_item_status" NOT NULL DEFAULT 'SENT',
  "received_at" TIMESTAMPTZ(6),
  "received_by" UUID,
  "rejected_at" TIMESTAMPTZ(6),
  "rejected_by" UUID,
  "reject_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "lab_partner_dispatch_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lab_partner_dispatch_item_version_check" CHECK ("version" >= 1),
  CONSTRAINT "lab_partner_dispatch_item_unit_cost_check" CHECK ("unit_cost" >= 0),
  CONSTRAINT "lab_partner_dispatch_item_received_check" CHECK ("status" <> 'RECEIVED' OR ("received_at" IS NOT NULL AND "received_by" IS NOT NULL)),
  CONSTRAINT "lab_partner_dispatch_item_rejected_check" CHECK ("status" <> 'REJECTED' OR ("rejected_at" IS NOT NULL AND "rejected_by" IS NOT NULL AND "reject_reason" IS NOT NULL AND char_length("reject_reason") BETWEEN 1 AND 500)),
  CONSTRAINT "lab_partner_dispatch_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_partner_dispatch_item_dispatch_fkey" FOREIGN KEY ("tenant_id", "dispatch_id") REFERENCES "lab_partner_dispatch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_partner_dispatch_item_order_item_fkey" FOREIGN KEY ("tenant_id", "clinical_order_item_id") REFERENCES "clinical_order_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_partner_dispatch_item_tube_fkey" FOREIGN KEY ("tenant_id", "specimen_tube_id") REFERENCES "specimen_tube"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lab_partner_dispatch_item_tenant_id_id_key" ON "lab_partner_dispatch_item"("tenant_id", "id");
-- Một dòng chỉ định chỉ có MỘT lần gửi đang hiệu lực (đã gửi hoặc đã nhận kết quả); các lần bị từ chối là lịch sử.
CREATE UNIQUE INDEX "lab_partner_dispatch_item_active_key" ON "lab_partner_dispatch_item"("tenant_id", "clinical_order_item_id") WHERE "status" IN ('SENT', 'RECEIVED') AND "deleted_at" IS NULL;
CREATE INDEX "lab_partner_dispatch_item_dispatch_idx" ON "lab_partner_dispatch_item"("tenant_id", "dispatch_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "lab_partner_dispatch_item_order_item_idx" ON "lab_partner_dispatch_item"("tenant_id", "clinical_order_item_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "lab_partner_dispatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_partner_dispatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lab_partner_dispatch"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
ALTER TABLE "lab_partner_dispatch_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_partner_dispatch_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lab_partner_dispatch_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
