-- Tab "Hình ảnh & Tài liệu" của hồ sơ bệnh nhân (docs/DECISIONS.md #299). Tệp nằm ngoài DB (StoragePort); bảng giữ khoá lưu + thông tin hiển thị.
-- Dữ liệu theo BỆNH NHÂN → dùng chung cả công ty (xem được ở mọi chi nhánh); branch_id chỉ ghi chi nhánh nơi tải lên.
-- Thư mục "ngày" không có bản ghi: nhóm lúc đọc theo upload_date (ngày Việt Nam do server tính). Chỉ thư mục tự tạo có bảng riêng.

CREATE TYPE "patient_document_category" AS ENUM ('PARACLINICAL', 'CLINICAL_PHOTO', 'CONTRACT', 'OTHER');
-- Giai đoạn 1 chỉ dùng UPLOAD; các giá trị còn lại dành cho dòng THAM CHIẾU chỉ đọc ở giai đoạn 2 (cùng storage_key với tệp gốc, không nhân đôi tệp).
CREATE TYPE "patient_document_source" AS ENUM ('UPLOAD', 'PARACLINICAL_IMAGE', 'LAB_PARTNER_RESULT', 'INSURANCE_CARD', 'PATIENT_PHOTO');

CREATE TABLE "patient_document_folder" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "patient_document_folder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_document_folder_version_check" CHECK ("version" >= 1),
  CONSTRAINT "patient_document_folder_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 60),
  CONSTRAINT "patient_document_folder_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_document_folder_patient_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "patient_document_folder_tenant_id_id_key" ON "patient_document_folder"("tenant_id", "id");
-- Tên thư mục không trùng (không phân biệt hoa thường) trong cùng một bệnh nhân.
CREATE UNIQUE INDEX "patient_document_folder_name_key" ON "patient_document_folder"("tenant_id", "patient_id", lower(btrim("name"))) WHERE "deleted_at" IS NULL;

CREATE TABLE "patient_document" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "folder_id" UUID,
  "encounter_id" UUID,
  "category" "patient_document_category" NOT NULL,
  "source_type" "patient_document_source" NOT NULL DEFAULT 'UPLOAD',
  "source_id" UUID,
  "storage_key" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" TEXT,
  "note" TEXT,
  "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "upload_date" DATE NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "patient_document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "patient_document_version_check" CHECK ("version" >= 1),
  CONSTRAINT "patient_document_size_check" CHECK ("size_bytes" >= 0),
  CONSTRAINT "patient_document_sha256_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "patient_document_display_name_check" CHECK (char_length(btrim("display_name")) BETWEEN 1 AND 200),
  -- Tải tay không có nguồn; tham chiếu bắt buộc có nguồn.
  CONSTRAINT "patient_document_source_check" CHECK (("source_type" = 'UPLOAD') = ("source_id" IS NULL)),
  CONSTRAINT "patient_document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_document_patient_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_document_branch_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_document_folder_fkey" FOREIGN KEY ("tenant_id", "folder_id") REFERENCES "patient_document_folder"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "patient_document_encounter_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "patient_document_tenant_id_id_key" ON "patient_document"("tenant_id", "id");
-- Danh sách của một bệnh nhân: mới nhất trước (nhóm theo ngày, tải theo lô bằng con trỏ).
CREATE INDEX "patient_document_patient_idx" ON "patient_document"("tenant_id", "patient_id", "upload_date" DESC, "id" DESC) WHERE "deleted_at" IS NULL;
CREATE INDEX "patient_document_category_idx" ON "patient_document"("tenant_id", "patient_id", "category") WHERE "deleted_at" IS NULL;
CREATE INDEX "patient_document_folder_idx" ON "patient_document"("tenant_id", "folder_id") WHERE "deleted_at" IS NULL AND "folder_id" IS NOT NULL;

ALTER TABLE "patient_document_folder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_document_folder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "patient_document_folder"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
ALTER TABLE "patient_document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_document" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "patient_document"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
