-- Cận lâm sàng GĐ4 — Thực hiện & kết quả (docs/DECISIONS.md #212). 2 bảng mới THEO TENANT + 2 cột lấy mẫu ở clinical_order_item, viết tay (không TTY),
-- đúng khuôn migration GĐ1-GĐ3: 8 cột bắt buộc, RLS, CHECK(version>=1), partial unique, trigger bất biến cho bản đã ký (đúng khuôn `prescription`).

-- ---------------------------------------------------------------------------------------------
-- clinical_order_item — thêm lúc lấy mẫu / gọi vào phòng
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "clinical_order_item" ADD COLUMN "collected_at" TIMESTAMPTZ(6);
ALTER TABLE "clinical_order_item" ADD COLUMN "collected_by" UUID;
-- Đã lấy mẫu/gọi vào thì phải có cả người lẫn lúc, và ngược lại.
ALTER TABLE "clinical_order_item" ADD CONSTRAINT "clinical_order_item_collected_pair_check" CHECK (("collected_at" IS NULL) = ("collected_by" IS NULL));

-- ---------------------------------------------------------------------------------------------
-- paraclinical_result — kết quả của MỘT dịch vụ được chỉ định (bản ký)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "paraclinical_result" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "clinical_order_item_id" UUID NOT NULL,
    "description_text" TEXT,
    "conclusion_text" TEXT,
    "performed_by" UUID,
    "resulted_at" TIMESTAMPTZ(6),
    "approver_id" UUID,
    "signed_at" TIMESTAMPTZ(6),
    "signed_by" UUID,
    "signature_payload" BYTEA,
    "printed_at" TIMESTAMPTZ(6),
    "supersedes_id" UUID,
    "amendment_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "paraclinical_result_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "paraclinical_result_tenant_id_id_key" ON "paraclinical_result"("tenant_id", "id");
-- Mỗi dịch vụ chỉ có đúng 1 kết quả ĐANG hiệu lực (bản đính chính thay thế bản cũ đã soft-delete).
CREATE UNIQUE INDEX "paraclinical_result_item_key" ON "paraclinical_result" ("tenant_id", "clinical_order_item_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "paraclinical_result" ADD CONSTRAINT "paraclinical_result_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "paraclinical_result" ADD CONSTRAINT "paraclinical_result_tenant_id_clinical_order_item_id_fkey" FOREIGN KEY ("tenant_id", "clinical_order_item_id") REFERENCES "clinical_order_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "paraclinical_result" ADD CONSTRAINT "paraclinical_result_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "paraclinical_result"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "paraclinical_result" ADD CONSTRAINT "paraclinical_result_version_check" CHECK (version >= 1);
-- Đã ký thì phải có người ký, và chỉ ký khi đã có thời gian có kết quả.
ALTER TABLE "paraclinical_result" ADD CONSTRAINT "paraclinical_result_signed_check" CHECK (
  ("signed_at" IS NULL AND "signed_by" IS NULL)
  OR ("signed_at" IS NOT NULL AND "signed_by" IS NOT NULL AND "resulted_at" IS NOT NULL)
);
-- Bản đính chính bắt buộc kèm lý do (Thông tư 46/2018/TT-BYT), bản gốc thì không có.
ALTER TABLE "paraclinical_result" ADD CONSTRAINT "paraclinical_result_amendment_check" CHECK (
  ("supersedes_id" IS NULL AND "amendment_reason" IS NULL)
  OR ("supersedes_id" IS NOT NULL AND "amendment_reason" IS NOT NULL AND btrim("amendment_reason") <> '')
);

-- ---------------------------------------------------------------------------------------------
-- paraclinical_result_value — từng chỉ số của kết quả xét nghiệm (snapshot tên/đơn vị/khoảng tham chiếu)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "paraclinical_result_value" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "lab_indicator_id" UUID NOT NULL,
    "indicator_code" TEXT NOT NULL,
    "indicator_name" TEXT NOT NULL,
    "abbreviation" TEXT,
    "unit" TEXT,
    "value_type" "lab_indicator_value_type" NOT NULL,
    "decimals" SMALLINT,
    "value_text" TEXT,
    "note" TEXT,
    "interpretation_text" TEXT,
    "reference_snapshot" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "paraclinical_result_value_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "paraclinical_result_value_tenant_id_id_key" ON "paraclinical_result_value"("tenant_id", "id");
CREATE INDEX "paraclinical_result_value_result_idx" ON "paraclinical_result_value" ("tenant_id", "result_id") WHERE "deleted_at" IS NULL;
-- Một chỉ số chỉ xuất hiện 1 lần trong cùng kết quả.
CREATE UNIQUE INDEX "paraclinical_result_value_indicator_key" ON "paraclinical_result_value" ("tenant_id", "result_id", "lab_indicator_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "paraclinical_result_value" ADD CONSTRAINT "paraclinical_result_value_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "paraclinical_result_value" ADD CONSTRAINT "paraclinical_result_value_tenant_id_result_id_fkey" FOREIGN KEY ("tenant_id", "result_id") REFERENCES "paraclinical_result"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "paraclinical_result_value" ADD CONSTRAINT "paraclinical_result_value_tenant_id_lab_indicator_id_fkey" FOREIGN KEY ("tenant_id", "lab_indicator_id") REFERENCES "lab_indicator"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "paraclinical_result_value" ADD CONSTRAINT "paraclinical_result_value_version_check" CHECK (version >= 1);

-- ---------------------------------------------------------------------------------------------
-- Bất biến sau khi ký (CLAUDE.md "Bản ghi đã ký là bất biến"; cùng khuôn nexamed_prevent_signed_prescription_update).
-- Chỉ chặn sửa NỘI DUNG đã ký; cho phép printed_at, soft-delete (khi đính chính), version/updated_*.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION nexamed_prevent_signed_paraclinical_result_update() RETURNS trigger AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
    NEW.clinical_order_item_id IS DISTINCT FROM OLD.clinical_order_item_id OR
    NEW.description_text IS DISTINCT FROM OLD.description_text OR
    NEW.conclusion_text IS DISTINCT FROM OLD.conclusion_text OR
    NEW.performed_by IS DISTINCT FROM OLD.performed_by OR
    NEW.resulted_at IS DISTINCT FROM OLD.resulted_at OR
    NEW.approver_id IS DISTINCT FROM OLD.approver_id OR
    NEW.signed_at IS DISTINCT FROM OLD.signed_at OR
    NEW.signed_by IS DISTINCT FROM OLD.signed_by OR
    NEW.signature_payload IS DISTINCT FROM OLD.signature_payload OR
    NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id OR
    NEW.amendment_reason IS DISTINCT FROM OLD.amendment_reason
  ) THEN
    RAISE EXCEPTION 'paraclinical_result % đã ký lúc %, không thể sửa nội dung đã ký — dùng luồng đính chính (supersedes_id)', OLD.id, OLD.signed_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER paraclinical_result_prevent_signed_update
  BEFORE UPDATE ON "paraclinical_result"
  FOR EACH ROW
  EXECUTE FUNCTION nexamed_prevent_signed_paraclinical_result_update();

-- Dòng chỉ số của kết quả ĐÃ KÝ: không thêm, không sửa nội dung (soft-delete/version/updated_* vẫn cho — dùng khi bản cũ bị đính chính thay thế).
CREATE FUNCTION nexamed_prevent_signed_paraclinical_value_change() RETURNS trigger AS $$
DECLARE
  parent_signed TIMESTAMPTZ;
BEGIN
  SELECT signed_at INTO parent_signed FROM paraclinical_result WHERE tenant_id = NEW.tenant_id AND id = NEW.result_id;
  IF TG_OP = 'INSERT' THEN
    IF parent_signed IS NOT NULL THEN
      RAISE EXCEPTION 'paraclinical_result % đã ký, không thêm được chỉ số — dùng luồng đính chính', NEW.result_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF parent_signed IS NOT NULL AND (
    NEW.result_id IS DISTINCT FROM OLD.result_id OR
    NEW.lab_indicator_id IS DISTINCT FROM OLD.lab_indicator_id OR
    NEW.indicator_code IS DISTINCT FROM OLD.indicator_code OR
    NEW.indicator_name IS DISTINCT FROM OLD.indicator_name OR
    NEW.abbreviation IS DISTINCT FROM OLD.abbreviation OR
    NEW.unit IS DISTINCT FROM OLD.unit OR
    NEW.value_type IS DISTINCT FROM OLD.value_type OR
    NEW.decimals IS DISTINCT FROM OLD.decimals OR
    NEW.value_text IS DISTINCT FROM OLD.value_text OR
    NEW.note IS DISTINCT FROM OLD.note OR
    NEW.interpretation_text IS DISTINCT FROM OLD.interpretation_text OR
    NEW.reference_snapshot IS DISTINCT FROM OLD.reference_snapshot OR
    NEW.sort_order IS DISTINCT FROM OLD.sort_order
  ) THEN
    RAISE EXCEPTION 'paraclinical_result_value % thuộc kết quả đã ký, không thể sửa — dùng luồng đính chính', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER paraclinical_result_value_prevent_signed_change
  BEFORE INSERT OR UPDATE ON "paraclinical_result_value"
  FOR EACH ROW
  EXECUTE FUNCTION nexamed_prevent_signed_paraclinical_value_change();

-- ---------------------------------------------------------------------------------------------
-- Row Level Security — cùng mẫu mọi bảng tenant khác
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "paraclinical_result" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paraclinical_result_value" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "paraclinical_result"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "paraclinical_result_value"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
