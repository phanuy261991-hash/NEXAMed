-- Cận lâm sàng GĐ4 đợt 2 (docs/DECISIONS.md #214) — ảnh đính kèm kết quả chẩn đoán hình ảnh / thăm dò chức năng (siêu âm, X-quang...). 1 bảng mới THEO TENANT,
-- file nằm ngoài DB (StoragePort), bảng chỉ giữ khoá lưu + thông tin hiển thị. Đúng khuôn migration GĐ4: 8 cột bắt buộc, RLS, CHECK(version>=1).

CREATE TABLE "paraclinical_result_image" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "paraclinical_result_image_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "paraclinical_result_image_tenant_id_id_key" ON "paraclinical_result_image"("tenant_id", "id");
CREATE INDEX "paraclinical_result_image_result_idx" ON "paraclinical_result_image" ("tenant_id", "result_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "paraclinical_result_image" ADD CONSTRAINT "paraclinical_result_image_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "paraclinical_result_image" ADD CONSTRAINT "paraclinical_result_image_tenant_id_result_id_fkey" FOREIGN KEY ("tenant_id", "result_id") REFERENCES "paraclinical_result"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "paraclinical_result_image" ADD CONSTRAINT "paraclinical_result_image_version_check" CHECK (version >= 1);
ALTER TABLE "paraclinical_result_image" ADD CONSTRAINT "paraclinical_result_image_size_check" CHECK (size_bytes > 0);

-- Ảnh là một phần NỘI DUNG kết quả: kết quả đã ký thì không thêm/đổi/gỡ ảnh (kể cả soft-delete) — sửa phải qua luồng đính chính.
CREATE FUNCTION nexamed_prevent_signed_paraclinical_image_change() RETURNS trigger AS $$
DECLARE
  parent_signed TIMESTAMPTZ;
BEGIN
  SELECT signed_at INTO parent_signed FROM paraclinical_result WHERE tenant_id = NEW.tenant_id AND id = NEW.result_id;
  IF parent_signed IS NOT NULL THEN
    RAISE EXCEPTION 'paraclinical_result % đã ký, không thêm/đổi/gỡ ảnh được — dùng luồng đính chính', NEW.result_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER paraclinical_result_image_prevent_signed_change
  BEFORE INSERT OR UPDATE ON "paraclinical_result_image"
  FOR EACH ROW
  EXECUTE FUNCTION nexamed_prevent_signed_paraclinical_image_change();

ALTER TABLE "paraclinical_result_image" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "paraclinical_result_image"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
