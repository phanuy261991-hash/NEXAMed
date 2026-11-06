-- Nền "Gửi mẫu đối tác" (docs/DECISIONS.md #291, mockup đã duyệt 06/11/2026) — giai đoạn 1.
-- (1) supplier.is_lab_partner: nhà cung cấp là ĐỐI TÁC XÉT NGHIỆM (dùng chung sổ công nợ NCC, Phiếu thanh toán, Đối chiếu).
-- (2) technical_service.sent_to_partner: phòng khám LẤY MẪU rồi gửi đối tác. Khác "chỉ định ra ngoài" (is_performed_in_house = false) nên CHECK: chỉ bật được khi is_performed_in_house.
-- (3) lab_partner_service_price: giá trả đối tác theo cặp (dịch vụ × đối tác), MỘT giá hiện hành, tối đa một đối tác mặc định mỗi dịch vụ. Dữ liệu chung cả công ty (không branch_id — như NCC).

ALTER TABLE "supplier" ADD COLUMN "is_lab_partner" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "technical_service" ADD COLUMN "sent_to_partner" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "technical_service" ADD CONSTRAINT "technical_service_sent_to_partner_check" CHECK (NOT "sent_to_partner" OR "is_performed_in_house");

CREATE TABLE "lab_partner_service_price" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "technical_service_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "amount" BIGINT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "lab_partner_service_price_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lab_partner_service_price_version_check" CHECK ("version" >= 1),
  CONSTRAINT "lab_partner_service_price_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "lab_partner_service_price_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_partner_service_price_service_fkey" FOREIGN KEY ("tenant_id", "technical_service_id") REFERENCES "technical_service"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lab_partner_service_price_supplier_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "lab_partner_service_price_tenant_id_id_key" ON "lab_partner_service_price"("tenant_id", "id");
-- Mỗi cặp (dịch vụ, đối tác) đúng MỘT giá hiện hành.
CREATE UNIQUE INDEX "lab_partner_service_price_pair_key" ON "lab_partner_service_price"("tenant_id", "technical_service_id", "supplier_id") WHERE "deleted_at" IS NULL;
-- Tối đa MỘT đối tác mặc định mỗi dịch vụ.
CREATE UNIQUE INDEX "lab_partner_service_price_default_key" ON "lab_partner_service_price"("tenant_id", "technical_service_id") WHERE "is_default" AND "deleted_at" IS NULL;
-- Tra giá theo đối tác (danh mục đối tác: số dịch vụ) và theo dịch vụ (form dịch vụ).
CREATE INDEX "lab_partner_service_price_supplier_idx" ON "lab_partner_service_price"("tenant_id", "supplier_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "lab_partner_service_price" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_partner_service_price" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lab_partner_service_price"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
