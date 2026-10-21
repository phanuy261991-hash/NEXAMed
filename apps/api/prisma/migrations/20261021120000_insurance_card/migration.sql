-- Thẻ bảo hiểm y tế (S2-04, docs/DECISIONS.md #243, mockup đã chốt 21/10/2026). v1 CHỈ lưu và hiển thị, không tính chi trả.
-- Thẻ theo BỆNH NHÂN → dùng CHUNG cả công ty (KHÔNG có branch_id); thông tin thẻ của từng lượt khám là bản chụp trên
-- encounter.insurance_snapshot (số thẻ lưu mã hoá), nên theo chi nhánh của lượt khám.
-- Số thẻ có HAI định dạng (mới 12 chữ số / cũ 15 ký tự chữ+số) — kiểu thẻ là giá trị tính ra, KHÔNG lưu cột riêng, KHÔNG CHECK độ dài
-- (sai định dạng chỉ là cảnh báo mềm, vẫn lưu được). Số thẻ lưu mã hoá AES-256-GCM (card_no_enc) + băm HMAC để tra trùng/tìm theo số thẻ.
-- patient.insurance_number (chuỗi tự do cũ) KHÔNG chuyển dữ liệu, ngừng đọc/ghi từ UI — cột giữ nguyên trong DB (khuôn family_history).

CREATE TABLE "insurance_card" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "card_no_enc" BYTEA NOT NULL,
  "card_no_hash" TEXT NOT NULL,
  "valid_from" DATE,
  "valid_to" DATE,
  "facility_code" TEXT,
  "facility_name" TEXT,
  "benefit_rate" SMALLINT,
  "photo_front_key" TEXT,
  "photo_back_key" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  CONSTRAINT "insurance_card_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "insurance_card_version_check" CHECK ("version" >= 1),
  CONSTRAINT "insurance_card_benefit_rate_check" CHECK ("benefit_rate" IS NULL OR ("benefit_rate" >= 0 AND "benefit_rate" <= 100)),
  CONSTRAINT "insurance_card_facility_code_check" CHECK ("facility_code" IS NULL OR "facility_code" ~ '^[0-9]{5}$'),
  CONSTRAINT "insurance_card_valid_range_check" CHECK ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_to" >= "valid_from"),
  CONSTRAINT "insurance_card_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "insurance_card_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patient"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "insurance_card_tenant_id_id_key" ON "insurance_card"("tenant_id", "id");
-- Danh sách thẻ của một bệnh nhân (hồ sơ, Tiếp nhận).
CREATE INDEX "insurance_card_patient_idx" ON "insurance_card"("tenant_id", "patient_id") WHERE "deleted_at" IS NULL;
-- Tìm bệnh nhân theo số thẻ (khớp chính xác, qua mã băm) + cảnh báo trùng số thẻ.
CREATE INDEX "insurance_card_hash_idx" ON "insurance_card"("tenant_id", "card_no_hash") WHERE "deleted_at" IS NULL;

ALTER TABLE "insurance_card" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "insurance_card" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "insurance_card"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
