-- "Quản lý mẫu in" (docs/DECISIONS.md #211) — bảng `print_template`. Viết tay (không TTY), đúng khuôn mọi
-- migration trước có RLS/partial unique index (công cụ diff không biểu diễn được các đối tượng này).

CREATE TYPE "PrintDocumentType" AS ENUM (
  'PRESCRIPTION', 'MEDICAL_RECORD', 'INVOICE', 'INVOICE_COMBINED', 'WALLET_TOPUP_RECEIPT',
  'CASHIER_SHIFT_RECEIPT', 'CASH_VOUCHER', 'STOCK_RECEIPT', 'STOCK_ISSUE', 'STOCK_COUNT', 'STOCK_TRANSFER'
);

CREATE TYPE "PrintPaperSize" AS ENUM ('A4', 'A5', 'A5_LANDSCAPE', 'K80');

CREATE TABLE "print_template" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "document_type" "PrintDocumentType" NOT NULL,
    "paper_size" "PrintPaperSize" NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "config_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "print_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "print_template_tenant_id_id_key" ON "print_template"("tenant_id", "id");

-- Mỗi chứng từ chỉ 1 bản mẫu cho mỗi khổ giấy (bản đã xoá mềm không tính).
CREATE UNIQUE INDEX "print_template_tenant_doc_paper_key"
  ON "print_template" ("tenant_id", "document_type", "paper_size")
  WHERE "deleted_at" IS NULL;

-- Mỗi chứng từ có ĐÚNG TỐI ĐA 1 bản mặc định (đặt mặc định là đổi cờ trong cùng transaction).
CREATE UNIQUE INDEX "print_template_tenant_doc_default_key"
  ON "print_template" ("tenant_id", "document_type")
  WHERE "is_default" AND "deleted_at" IS NULL;

ALTER TABLE "print_template" ADD CONSTRAINT "print_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_template" ADD CONSTRAINT "print_template_version_check" CHECK (version >= 1);

ALTER TABLE "print_template" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "print_template"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
