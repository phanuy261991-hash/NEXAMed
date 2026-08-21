-- Danh mục "Dị nguyên" (docs/DECISIONS.md #069) — TOÀN HỆ THỐNG, cùng bản chất reference_catalog:
-- không tenant_id, không đủ 8 cột bắt buộc, không version. Viết tay (không có TTY để chạy
-- `prisma migrate dev`), cùng cách mọi migration trước trên bảng danh mục toàn hệ thống.
--
-- DELETE đã bị revoke toàn cục cho nexamed_app từ migration *_tenant_context (áp dụng cho mọi
-- bảng, kể cả bảng tạo sau) — không cần REVOKE DELETE ở đây. GRANT SELECT/INSERT/UPDATE mặc định
-- của nexamed_app (qua ALTER DEFAULT PRIVILEGES) đã đủ để clinic_admin quản lý qua API — "xoá" là
-- is_active=false (soft), không phải DELETE thật.

CREATE TABLE "allergen_group" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "allergen_group_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "allergen_group_code_key" ON "allergen_group"("code");

CREATE TABLE "allergen" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "allergen_group_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "allergen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "allergen_code_key" ON "allergen"("code");
CREATE INDEX "allergen_allergen_group_id_idx" ON "allergen"("allergen_group_id");

ALTER TABLE "allergen" ADD CONSTRAINT "allergen_allergen_group_id_fkey" FOREIGN KEY ("allergen_group_id") REFERENCES "allergen_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
