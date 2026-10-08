-- Cận lâm sàng GĐ3 — Chỉ định của bác sĩ (docs/DECISIONS.md #212). 3 bảng mới THEO TENANT + 2 cột nguồn mới ở invoice_line, viết tay (không TTY),
-- đúng khuôn migration GĐ1/GĐ2: 8 cột bắt buộc, RLS, CHECK(version>=1), partial unique cho mã/đúng-1 phiếu mỗi lượt khám.

CREATE TYPE "clinical_order_item_kind" AS ENUM ('TECHNICAL_SERVICE', 'EXAM_TYPE', 'FREE_TEXT');
CREATE TYPE "clinical_order_performance" AS ENUM ('IN_HOUSE', 'EXTERNAL');
-- GĐ4 (Thực hiện & kết quả) sẽ thêm các trạng thái lấy mẫu/thực hiện/có kết quả/đã duyệt bằng migration riêng.
CREATE TYPE "clinical_order_item_status" AS ENUM ('ORDERED', 'CANCELLED');

-- ---------------------------------------------------------------------------------------------
-- clinical_order — PHIẾU chỉ định cận lâm sàng: đúng 1 phiếu còn hiệu lực mỗi lượt khám (bác sĩ thêm/bớt dòng trên cùng phiếu)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "clinical_order" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "encounter_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "clinical_order_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_order_tenant_id_id_key" ON "clinical_order"("tenant_id", "id");
CREATE UNIQUE INDEX "clinical_order_tenant_order_no_key" ON "clinical_order" ("tenant_id", "order_no") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "clinical_order_encounter_key" ON "clinical_order" ("tenant_id", "encounter_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "clinical_order" ADD CONSTRAINT "clinical_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_order" ADD CONSTRAINT "clinical_order_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounter"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_order" ADD CONSTRAINT "clinical_order_version_check" CHECK (version >= 1);

-- ---------------------------------------------------------------------------------------------
-- clinical_order_package — gói được chỉ định ("+ Thêm theo gói"): hoá đơn ghi ĐÚNG 1 dòng "gói" (giá snapshot lúc chỉ định)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "clinical_order_package" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "clinical_order_id" UUID NOT NULL,
    "service_package_id" UUID NOT NULL,
    "package_code" TEXT NOT NULL,
    "package_name" TEXT NOT NULL,
    -- Giá gói ĐÃ chốt lúc chỉ định (sau bảng giá có thời hạn theo ngày chỉ định) — không đổi khi bảng giá/đơn giá dịch vụ con đổi sau đó.
    "unit_price" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "clinical_order_package_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_order_package_tenant_id_id_key" ON "clinical_order_package"("tenant_id", "id");
CREATE INDEX "clinical_order_package_order_idx" ON "clinical_order_package" ("tenant_id", "clinical_order_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "clinical_order_package" ADD CONSTRAINT "clinical_order_package_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_order_package" ADD CONSTRAINT "clinical_order_package_tenant_id_clinical_order_id_fkey" FOREIGN KEY ("tenant_id", "clinical_order_id") REFERENCES "clinical_order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_order_package" ADD CONSTRAINT "clinical_order_package_tenant_id_service_package_id_fkey" FOREIGN KEY ("tenant_id", "service_package_id") REFERENCES "service_package"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_order_package" ADD CONSTRAINT "clinical_order_package_version_check" CHECK (version >= 1);
ALTER TABLE "clinical_order_package" ADD CONSTRAINT "clinical_order_package_price_check" CHECK (unit_price >= 0);

-- ---------------------------------------------------------------------------------------------
-- clinical_order_item — từng dịch vụ được chỉ định
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "clinical_order_item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "clinical_order_id" UUID NOT NULL,
    "item_kind" "clinical_order_item_kind" NOT NULL,
    "technical_service_id" UUID,
    -- Dịch vụ khám nằm trong gói (`reference_catalog` EXAM_TYPE) — lưu mã thẳng, không FK cứng (cùng khuôn exam_type_price).
    "exam_type_code" TEXT,
    "free_text_name" TEXT,
    -- Snapshot mã/tên lúc chỉ định (in phiếu + hoá đơn không đổi khi danh mục đổi tên). Dòng tự do: code NULL.
    "code" TEXT,
    "name" TEXT NOT NULL,
    "performance" "clinical_order_performance" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    -- Đơn giá snapshot — CHỈ dịch vụ tại phòng khám LẺ (không thuộc gói) mới có; ra ngoài/thuộc gói = NULL (không tính tiền riêng).
    "unit_price" BIGINT,
    "price_type_code" TEXT,
    "unit_code" TEXT,
    "clinical_order_package_id" UUID,
    -- "Lưu ý cho người bệnh" của dịch vụ chỉ định ra ngoài (in trên phiếu).
    "note" TEXT,
    "status" "clinical_order_item_status" NOT NULL DEFAULT 'ORDERED',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "clinical_order_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinical_order_item_tenant_id_id_key" ON "clinical_order_item"("tenant_id", "id");
CREATE INDEX "clinical_order_item_order_idx" ON "clinical_order_item" ("tenant_id", "clinical_order_id") WHERE "deleted_at" IS NULL;
-- GĐ4: hàng đợi cận lâm sàng lọc theo trạng thái + dịch vụ.
CREATE INDEX "clinical_order_item_status_idx" ON "clinical_order_item" ("tenant_id", "status") WHERE "deleted_at" IS NULL;

ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_tenant_id_clinical_order_id_fkey" FOREIGN KEY ("tenant_id", "clinical_order_id") REFERENCES "clinical_order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_tenant_id_technical_service_id_fkey" FOREIGN KEY ("tenant_id", "technical_service_id") REFERENCES "technical_service"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_tenant_id_clinical_order_package_id_fkey" FOREIGN KEY ("tenant_id", "clinical_order_package_id") REFERENCES "clinical_order_package"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_version_check" CHECK (version >= 1);
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_quantity_check" CHECK (quantity >= 1 AND quantity <= 999);
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_price_check" CHECK (unit_price IS NULL OR unit_price >= 0);
-- Đúng-1-trong-3 tham chiếu theo loại dòng.
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_ref_check" CHECK (
  (item_kind = 'TECHNICAL_SERVICE' AND technical_service_id IS NOT NULL AND exam_type_code IS NULL AND free_text_name IS NULL)
  OR (item_kind = 'EXAM_TYPE' AND exam_type_code IS NOT NULL AND technical_service_id IS NULL AND free_text_name IS NULL)
  OR (item_kind = 'FREE_TEXT' AND free_text_name IS NOT NULL AND technical_service_id IS NULL AND exam_type_code IS NULL)
);
-- Tên tự do chỉ để CHỈ ĐỊNH RA NGOÀI (không có giá/hàng đợi/kết quả — đúng khuôn "Kê thuốc tự do" #192); dịch vụ khám chỉ nằm trong gói tại phòng khám.
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_kind_performance_check" CHECK (
  (item_kind = 'FREE_TEXT' AND performance = 'EXTERNAL')
  OR (item_kind = 'EXAM_TYPE' AND performance = 'IN_HOUSE' AND clinical_order_package_id IS NOT NULL)
  OR item_kind = 'TECHNICAL_SERVICE'
);
-- Tiền: chỉ dòng tại phòng khám LẺ có đơn giá; ra ngoài và dòng thuộc gói thì không.
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_pricing_check" CHECK (
  (performance = 'EXTERNAL' AND unit_price IS NULL AND clinical_order_package_id IS NULL)
  OR (performance = 'IN_HOUSE' AND clinical_order_package_id IS NOT NULL AND unit_price IS NULL)
  OR (performance = 'IN_HOUSE' AND clinical_order_package_id IS NULL AND unit_price IS NOT NULL)
);

-- ---------------------------------------------------------------------------------------------
-- invoice_line — thêm 2 nguồn mới: dòng chỉ định lẻ / dòng gói. Đúng-1-trong-4 nguồn (thay CHECK đúng-1-trong-2 của Kho Thuốc GĐ3).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "invoice_line" ADD COLUMN "source_order_item_id" UUID;
ALTER TABLE "invoice_line" ADD COLUMN "source_order_package_id" UUID;
CREATE INDEX "invoice_line_tenant_id_source_order_item_id_idx" ON "invoice_line"("tenant_id", "source_order_item_id");
CREATE INDEX "invoice_line_tenant_id_source_order_package_id_idx" ON "invoice_line"("tenant_id", "source_order_package_id");
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_source_order_item_id_fkey" FOREIGN KEY ("tenant_id", "source_order_item_id") REFERENCES "clinical_order_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_tenant_id_source_order_package_id_fkey" FOREIGN KEY ("tenant_id", "source_order_package_id") REFERENCES "clinical_order_package"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_line" DROP CONSTRAINT "invoice_line_source_exactly_one_check";
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_source_exactly_one_check" CHECK (
  (("source_service_item_id" IS NOT NULL)::int + ("source_stock_issue_line_id" IS NOT NULL)::int
    + ("source_order_item_id" IS NOT NULL)::int + ("source_order_package_id" IS NOT NULL)::int) = 1
);

-- ---------------------------------------------------------------------------------------------
-- Row Level Security — cùng mẫu mọi bảng tenant khác
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "clinical_order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_order_package" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_order_item" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "clinical_order"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "clinical_order_package"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "clinical_order_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
