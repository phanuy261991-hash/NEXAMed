-- "Gửi mẫu đối tác" giai đoạn 2 phần còn lại (docs/DECISIONS.md #291 bổ sung 5): NHẬN kết quả PDF từ đối tác, ghi nợ khi nhận.
-- (1) `lab_partner_result_file` = MỘT file PDF kết quả nhận về, gắn được cho NHIỀU dòng gửi của cùng một đối tác (THEO CHI NHÁNH nơi nhận). File lưu qua StoragePort (`storage_key`).
-- (2) `lab_partner_dispatch_item.result_file_id` trỏ file đã nhận cho dòng đó (NULL khi chưa nhận hoặc đã trả lại kỹ thuật viên).
-- (3) `supplier_debt_entry` thêm loại bút toán `LAB_PARTNER` (ghi nợ xét nghiệm đối tác lúc NHẬN kết quả, đúng `unit_cost` đã chụp lúc gửi) + cột nguồn `lab_partner_dispatch_item_id`.
--     `ADD VALUE` không dùng được trong CÙNG giao dịch với câu lệnh có chứa giá trị mới ở dạng enum, nên CHECK nguồn dưới đây so sánh `entry_type::text`.

ALTER TYPE "supplier_debt_entry_type" ADD VALUE 'LAB_PARTNER';

CREATE TABLE "lab_partner_result_file" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "storage_key" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "received_by" UUID NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "lab_partner_result_file_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lab_partner_result_file_version_check" CHECK ("version" >= 1),
  CONSTRAINT "lab_partner_result_file_size_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "lab_partner_result_file_note_check" CHECK ("note" IS NULL OR char_length("note") <= 1000),
  CONSTRAINT "lab_partner_result_file_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_partner_result_file_branch_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_partner_result_file_supplier_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lab_partner_result_file_tenant_id_id_key" ON "lab_partner_result_file"("tenant_id", "id");
CREATE INDEX "lab_partner_result_file_supplier_idx" ON "lab_partner_result_file"("tenant_id", "supplier_id", "received_at" DESC) WHERE "deleted_at" IS NULL;

ALTER TABLE "lab_partner_result_file" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_partner_result_file" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lab_partner_result_file"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "lab_partner_dispatch_item" ADD COLUMN "result_file_id" UUID;
ALTER TABLE "lab_partner_dispatch_item" ADD CONSTRAINT "lab_partner_dispatch_item_result_file_fkey" FOREIGN KEY ("tenant_id", "result_file_id") REFERENCES "lab_partner_result_file"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Đã nhận kết quả thì phải có file kèm theo.
ALTER TABLE "lab_partner_dispatch_item" ADD CONSTRAINT "lab_partner_dispatch_item_result_file_check" CHECK ("status" <> 'RECEIVED' OR "result_file_id" IS NOT NULL);
CREATE INDEX "lab_partner_dispatch_item_result_file_idx" ON "lab_partner_dispatch_item"("tenant_id", "result_file_id") WHERE "deleted_at" IS NULL AND "result_file_id" IS NOT NULL;

ALTER TABLE "supplier_debt_entry" ADD COLUMN "lab_partner_dispatch_item_id" UUID;
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_lab_partner_item_fkey" FOREIGN KEY ("tenant_id", "lab_partner_dispatch_item_id") REFERENCES "lab_partner_dispatch_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "supplier_debt_entry_lab_partner_item_idx" ON "supplier_debt_entry"("tenant_id", "lab_partner_dispatch_item_id") WHERE "lab_partner_dispatch_item_id" IS NOT NULL;

ALTER TABLE "supplier_debt_entry" DROP CONSTRAINT "supplier_debt_entry_source_check";
ALTER TABLE "supplier_debt_entry" ADD CONSTRAINT "supplier_debt_entry_source_check" CHECK (
  (entry_type = 'PURCHASE' AND stock_receipt_id IS NOT NULL) OR
  (entry_type = 'OPENING_BALANCE' AND stock_receipt_id IS NULL AND cash_voucher_id IS NULL) OR
  (entry_type IN ('PAYMENT', 'REFUND_RECEIVED') AND cash_voucher_id IS NOT NULL) OR
  (entry_type = 'RETURN' AND stock_issue_id IS NOT NULL) OR
  (entry_type IN ('ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE') AND adjustment_id IS NOT NULL) OR
  (entry_type::text = 'LAB_PARTNER' AND lab_partner_dispatch_item_id IS NOT NULL) OR
  (entry_type = 'REVERSAL')
);
