-- "Đơn giá dịch vụ" (docs/DECISIONS.md #079, chủ dự án yêu cầu trực tiếp 2026-08-26) — bảng giá
-- đa mức THEO TENANT cho reference_catalog category EXAM_TYPE. Xem comment đầy đủ ở
-- schema.prisma model ExamTypePrice.

-- CreateTable
CREATE TABLE "exam_type_price" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "exam_type_code" TEXT NOT NULL,
    "price_type_code" TEXT NOT NULL,
    "unit_code" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "exam_type_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_type_price_tenant_id_id_key" ON "exam_type_price"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "exam_type_price" ADD CONSTRAINT "exam_type_price_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (version >= 1) — optimistic locking, .claude/docs/data-model.md.
ALTER TABLE "exam_type_price" ADD CONSTRAINT "exam_type_price_version_check" CHECK (version >= 1);

-- Row Level Security — cùng mẫu mọi bảng tenant khác.
ALTER TABLE "exam_type_price" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "exam_type_price"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Index tra cứu chính: liệt kê đơn giá của 1 dịch vụ khám (mở modal Sửa) — chỉ dòng còn hiệu lực.
CREATE INDEX "exam_type_price_tenant_id_exam_type_code_idx" ON "exam_type_price" ("tenant_id", "exam_type_code") WHERE "deleted_at" IS NULL;

-- C20 (docs/ERD.md mục 4) — chặn 2 dòng đơn giá CÙNG dịch vụ + CÙNG Loại giá dịch vụ có khoảng
-- ngày hiệu lực chồng lấn nhau (chốt qua AskUserQuestion 2026-08-26), kể cả khi 2 request ghi đồng
-- thời — cùng tinh thần C2 (appointment slot). GiST cần btree_gist để dùng toán tử "=" trên cột
-- uuid/text trong cùng exclusion constraint với toán tử "&&" trên daterange.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- "Ngày kết thúc" bỏ trống = hiệu lực vô thời hạn — coalesce về 'infinity' để daterange so khớp
-- đúng với dòng chưa có ngày kết thúc. Hàm IMMUTABLE riêng vì exclusion constraint không nhận
-- biểu thức thẳng chứa hàm không đánh dấu IMMUTABLE (cùng lý do nexamed_appointment_slot_range()
-- ở migration *_appointment_s2_05).
CREATE OR REPLACE FUNCTION nexamed_exam_type_price_range(effective_from DATE, effective_to DATE)
RETURNS DATERANGE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]');
$$;

ALTER TABLE "exam_type_price" ADD CONSTRAINT "exam_type_price_no_overlap_excl"
  EXCLUDE USING gist (
    tenant_id WITH =,
    exam_type_code WITH =,
    price_type_code WITH =,
    nexamed_exam_type_price_range(effective_from, effective_to) WITH &&
  )
  WHERE (deleted_at IS NULL);