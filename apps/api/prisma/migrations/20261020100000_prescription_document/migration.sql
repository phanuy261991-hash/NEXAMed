-- Mã đơn thuốc theo Bộ Y tế, GIAI ĐOẠN 2 (docs/DECISIONS.md #242): đơn pháp lý (mỗi loại đơn C/N/H/Y một mã chuẩn), cờ "Đông y", liên kết dòng thuốc ↔ đơn pháp lý.
--
-- 1) drug.is_traditional — "Thuốc y học cổ truyền (Đông y)" (mặc định false, thuốc cũ không đổi hành vi).
-- 2) prescription_document — MỘT lần ký đơn ở chế độ "Chuẩn Bộ Y tế" tách thành N đơn pháp lý (mỗi loại một mã `xxxxxyyyyyyy-z`). Bảng chỉ GHI khi ký (không sửa
--    nội dung sau đó, chỉ soft-delete khi đơn bị đính chính). `prescription` vẫn là một dòng/lượt khám nên kho, phát thuốc, đính chính giữ nguyên.
-- 3) prescription_item.document_id — dòng thuốc thuộc đơn pháp lý nào (NULL: còn nháp, hoặc đơn ký trước ngày bật chế độ chuẩn).
--
-- Chi nhánh: kế thừa qua prescription → encounter.branch_id (không thêm cột). Forward-only.

ALTER TABLE "drug" ADD COLUMN "is_traditional" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "prescription_document" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "prescription_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "national_code" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "prescription_document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prescription_document_version_check" CHECK ("version" >= 1),
  CONSTRAINT "prescription_document_kind_check" CHECK ("kind" IN ('C', 'N', 'H', 'Y')),
  -- 5 chữ số mã cơ sở + 7 chữ số bộ đếm + '-' + loại đơn; ký tự cuối PHẢI khớp `kind`.
  CONSTRAINT "prescription_document_national_code_check" CHECK ("national_code" ~ '^[0-9]{12}-[CNHY]$' AND right("national_code", 1) = "kind"),
  CONSTRAINT "prescription_document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "prescription_document_tenant_id_prescription_id_fkey" FOREIGN KEY ("tenant_id", "prescription_id") REFERENCES "prescription"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "prescription_document_tenant_id_id_key" ON "prescription_document"("tenant_id", "id");
-- Mã chuẩn duy nhất trong công ty cho bản ĐANG hiệu lực (đơn đính chính giữ mã của đơn gốc nên bản cũ bị soft-delete cùng lúc dòng mới được tạo).
CREATE UNIQUE INDEX "prescription_document_national_code_active_key" ON "prescription_document"("tenant_id", "national_code") WHERE "deleted_at" IS NULL;
CREATE INDEX "prescription_document_tenant_id_prescription_id_idx" ON "prescription_document"("tenant_id", "prescription_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "prescription_document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prescription_document" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "prescription_document"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "prescription_item" ADD COLUMN "document_id" UUID;
ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_tenant_id_document_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id") REFERENCES "prescription_document"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "prescription_item_tenant_id_document_id_idx" ON "prescription_item"("tenant_id", "document_id") WHERE "document_id" IS NOT NULL AND "deleted_at" IS NULL;
