-- Ký hồ sơ khám + đính chính (Sprint 5, S5-02/03, ENC-04/05) — xem .claude/docs/clinical-workflow.md
-- mục "Khám bệnh"/"Amendment hồ sơ", docs/DECISIONS.md. Viết tay (không `prisma migrate diff`) vì
-- có trigger + backfill dữ liệu — công cụ diff không biểu diễn được.

-- `clinical_note` đã có sẵn 4 cột SignableEntity từ `20260820120000_clinical_diagnosis_note`
-- (luôn NULL tới nay) — chỉ cần thêm composite FK self-reference (chưa từng có) + trigger bên dưới.
ALTER TABLE "clinical_note" ADD CONSTRAINT "clinical_note_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "clinical_note"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "clinical_note_tenant_id_supersedes_id_idx" ON "clinical_note" ("tenant_id", "supersedes_id") WHERE "supersedes_id" IS NOT NULL;

-- `diagnosis` KHÔNG có sẵn 4 cột này (khác `clinical_note`) — thêm mới, đúng khuôn `prescription`.
ALTER TABLE "diagnosis" ADD COLUMN "signed_at" TIMESTAMPTZ(6);
ALTER TABLE "diagnosis" ADD COLUMN "signed_by" UUID;
ALTER TABLE "diagnosis" ADD COLUMN "supersedes_id" UUID;
ALTER TABLE "diagnosis" ADD COLUMN "amendment_reason" TEXT;

ALTER TABLE "diagnosis" ADD CONSTRAINT "diagnosis_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "diagnosis"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "diagnosis_tenant_id_supersedes_id_idx" ON "diagnosis" ("tenant_id", "supersedes_id") WHERE "supersedes_id" IS NOT NULL;

-- Backfill — mọi diagnosis/clinical_note của encounter ĐÃ `COMPLETED` từ trước khi tính năng ký
-- tồn tại vẫn còn `signed_at IS NULL`. Không backfill thì các encounter cũ sẽ ở trạng thái "vừa
-- completed vừa chưa ký", mâu thuẫn với luật mới (COMPLETED ⟺ đã ký). Xấp xỉ hợp lý cho dữ liệu
-- lịch sử: `signed_at = encounter.completed_at`, `signed_by = encounter.updated_by` (không có actor
-- chính xác hơn — hệ thống chưa từng ghi "ai đã ký" trước migration này).
UPDATE "diagnosis" d
SET "signed_at" = e."completed_at", "signed_by" = e."updated_by"
FROM "encounter" e
WHERE d."tenant_id" = e."tenant_id" AND d."encounter_id" = e."id"
  AND e."status" = 'COMPLETED' AND d."signed_at" IS NULL AND d."deleted_at" IS NULL;

UPDATE "clinical_note" cn
SET "signed_at" = e."completed_at", "signed_by" = e."updated_by"
FROM "encounter" e
WHERE cn."tenant_id" = e."tenant_id" AND cn."encounter_id" = e."id"
  AND e."status" = 'COMPLETED' AND cn."signed_at" IS NULL AND cn."deleted_at" IS NULL;

-- C8 (docs/ERD.md mục 4) cho `diagnosis`/`clinical_note` — đúng khuôn
-- `nexamed_prevent_signed_prescription_update` (`20260825090000_prescription`). CHỈ chặn sửa đúng
-- "nội dung đã ký" — CHO PHÉP deleted_at/deleted_reason (soft-delete khi đính chính),
-- version/updated_at/updated_by (routine) tiếp tục đổi được sau khi ký.
CREATE FUNCTION nexamed_prevent_signed_diagnosis_update() RETURNS trigger AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
    NEW.encounter_id IS DISTINCT FROM OLD.encounter_id OR
    NEW.icd10_code IS DISTINCT FROM OLD.icd10_code OR
    NEW.type IS DISTINCT FROM OLD.type OR
    NEW.note IS DISTINCT FROM OLD.note OR
    NEW.signed_at IS DISTINCT FROM OLD.signed_at OR
    NEW.signed_by IS DISTINCT FROM OLD.signed_by OR
    NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id OR
    NEW.amendment_reason IS DISTINCT FROM OLD.amendment_reason
  ) THEN
    RAISE EXCEPTION 'diagnosis % đã ký lúc %, không thể sửa nội dung đã ký — dùng luồng đính chính (supersedes_id)', OLD.id, OLD.signed_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER diagnosis_prevent_signed_update
  BEFORE UPDATE ON "diagnosis"
  FOR EACH ROW
  EXECUTE FUNCTION nexamed_prevent_signed_diagnosis_update();

CREATE FUNCTION nexamed_prevent_signed_clinical_note_update() RETURNS trigger AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
    NEW.encounter_id IS DISTINCT FROM OLD.encounter_id OR
    NEW.section IS DISTINCT FROM OLD.section OR
    NEW.content IS DISTINCT FROM OLD.content OR
    NEW.signed_at IS DISTINCT FROM OLD.signed_at OR
    NEW.signed_by IS DISTINCT FROM OLD.signed_by OR
    NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id OR
    NEW.amendment_reason IS DISTINCT FROM OLD.amendment_reason
  ) THEN
    RAISE EXCEPTION 'clinical_note % đã ký lúc %, không thể sửa nội dung đã ký — dùng luồng đính chính (supersedes_id)', OLD.id, OLD.signed_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clinical_note_prevent_signed_update
  BEFORE UPDATE ON "clinical_note"
  FOR EACH ROW
  EXECUTE FUNCTION nexamed_prevent_signed_clinical_note_update();
