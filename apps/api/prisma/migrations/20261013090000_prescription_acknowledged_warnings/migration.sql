-- "Bỏ qua cảnh báo trùng hoạt chất cho đơn này" (docs/DECISIONS.md #228).
-- Cột JSONB lưu các cảnh báo bác sĩ đã bỏ qua trên đơn NHÁP: [{ key, reason, by, byName, at }]. Đơn cũ mặc định '[]'.
ALTER TABLE "prescription" ADD COLUMN "acknowledged_warnings" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "prescription" ADD CONSTRAINT "prescription_acknowledged_warnings_array_check" CHECK (jsonb_typeof("acknowledged_warnings") = 'array');

-- Đơn đã ký bất biến: thêm cột mới vào danh sách cột bị trigger chặn đổi sau ký (dấu vết bỏ qua cảnh báo phải giữ nguyên như lúc ký).
CREATE OR REPLACE FUNCTION nexamed_prevent_signed_prescription_update() RETURNS trigger AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
    NEW.encounter_id IS DISTINCT FROM OLD.encounter_id OR
    NEW.signed_at IS DISTINCT FROM OLD.signed_at OR
    NEW.signed_by IS DISTINCT FROM OLD.signed_by OR
    NEW.signature_payload IS DISTINCT FROM OLD.signature_payload OR
    NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id OR
    NEW.amendment_reason IS DISTINCT FROM OLD.amendment_reason OR
    NEW.acknowledged_warnings IS DISTINCT FROM OLD.acknowledged_warnings
  ) THEN
    RAISE EXCEPTION 'prescription % đã ký lúc %, không thể sửa nội dung đã ký — dùng luồng đính chính (supersedes_id)', OLD.id, OLD.signed_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
