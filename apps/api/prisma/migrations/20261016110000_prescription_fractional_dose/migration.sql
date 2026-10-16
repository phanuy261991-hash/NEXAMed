-- "Liều chia lẻ + lời dặn riêng của đơn thuốc" (docs/DECISIONS.md #241, mockup đã duyệt).
--
-- 1) Liều Sáng/Trưa/Chiều/Tối của đơn và đơn mẫu đổi từ SMALLINT sang NUMERIC(5,2) để kê ¼, ½, 1½ viên.
--    CHECK: không âm và là bội của 0,25. Giá trị nguyên cũ chuyển nguyên vẹn (đơn đã ký không đổi nội dung).
--    `quantity` giữ INTEGER: từ nay = LÀM TRÒN LÊN(tổng liều × số ngày), do backend tính.
-- 2) drug.is_splittable — "Cho phép chia nhỏ" (mặc định true, thuốc cũ không đổi hành vi).
-- 3) prescription.doctor_advice — lời dặn riêng của đơn, thêm vào danh sách cột bị trigger chặn sửa sau ký.

-- ============ prescription_item ============
ALTER TABLE "prescription_item"
  ALTER COLUMN "dose_morning" TYPE NUMERIC(5,2) USING "dose_morning"::numeric,
  ALTER COLUMN "dose_noon" TYPE NUMERIC(5,2) USING "dose_noon"::numeric,
  ALTER COLUMN "dose_afternoon" TYPE NUMERIC(5,2) USING "dose_afternoon"::numeric,
  ALTER COLUMN "dose_evening" TYPE NUMERIC(5,2) USING "dose_evening"::numeric;
ALTER TABLE "prescription_item" ADD CONSTRAINT "prescription_item_dose_quarter_check" CHECK (
  "dose_morning" >= 0 AND "dose_noon" >= 0 AND "dose_afternoon" >= 0 AND "dose_evening" >= 0
  AND ("dose_morning" * 4) = trunc("dose_morning" * 4)
  AND ("dose_noon" * 4) = trunc("dose_noon" * 4)
  AND ("dose_afternoon" * 4) = trunc("dose_afternoon" * 4)
  AND ("dose_evening" * 4) = trunc("dose_evening" * 4)
);

-- ============ prescription_template_item ============
ALTER TABLE "prescription_template_item"
  ALTER COLUMN "dose_morning" TYPE NUMERIC(5,2) USING "dose_morning"::numeric,
  ALTER COLUMN "dose_noon" TYPE NUMERIC(5,2) USING "dose_noon"::numeric,
  ALTER COLUMN "dose_afternoon" TYPE NUMERIC(5,2) USING "dose_afternoon"::numeric,
  ALTER COLUMN "dose_evening" TYPE NUMERIC(5,2) USING "dose_evening"::numeric;
ALTER TABLE "prescription_template_item" ADD CONSTRAINT "prescription_template_item_dose_quarter_check" CHECK (
  "dose_morning" >= 0 AND "dose_noon" >= 0 AND "dose_afternoon" >= 0 AND "dose_evening" >= 0
  AND ("dose_morning" * 4) = trunc("dose_morning" * 4)
  AND ("dose_noon" * 4) = trunc("dose_noon" * 4)
  AND ("dose_afternoon" * 4) = trunc("dose_afternoon" * 4)
  AND ("dose_evening" * 4) = trunc("dose_evening" * 4)
);

-- ============ drug ============
ALTER TABLE "drug" ADD COLUMN "is_splittable" BOOLEAN NOT NULL DEFAULT true;

-- ============ prescription ============
ALTER TABLE "prescription" ADD COLUMN "doctor_advice" TEXT;

CREATE OR REPLACE FUNCTION nexamed_prevent_signed_prescription_update() RETURNS trigger AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
    NEW.encounter_id IS DISTINCT FROM OLD.encounter_id OR
    NEW.signed_at IS DISTINCT FROM OLD.signed_at OR
    NEW.signed_by IS DISTINCT FROM OLD.signed_by OR
    NEW.signature_payload IS DISTINCT FROM OLD.signature_payload OR
    NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id OR
    NEW.amendment_reason IS DISTINCT FROM OLD.amendment_reason OR
    NEW.acknowledged_warnings IS DISTINCT FROM OLD.acknowledged_warnings OR
    NEW.doctor_advice IS DISTINCT FROM OLD.doctor_advice
  ) THEN
    RAISE EXCEPTION 'prescription % đã ký lúc %, không thể sửa nội dung đã ký — dùng luồng đính chính (supersedes_id)', OLD.id, OLD.signed_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
