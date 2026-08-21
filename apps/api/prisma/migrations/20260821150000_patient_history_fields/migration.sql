-- Chuyển "Tiền sử bản thân"/"Tiền sử gia đình" từ clinical_note (gắn theo từng lượt khám) sang
-- patient (dữ liệu chung, ít đổi) — đúng khuôn patient.allergy_note đã có từ trước
-- (docs/DECISIONS.md #068). Lý do: bác sĩ phải gõ lại 2 trường này từ đầu mỗi lượt khám mới dù nội
-- dung hầu như không đổi giữa các lần khám của cùng một bệnh nhân — bất tiện, không đúng bản chất
-- dữ liệu.

ALTER TABLE "patient" ADD COLUMN "personal_history" TEXT;
ALTER TABLE "patient" ADD COLUMN "family_history" TEXT;

-- Backfill: lấy nội dung KHÔNG RỖNG gần nhất (theo encounter.checked_in_at) của mỗi bệnh nhân cho
-- từng mục, trước khi xoá dữ liệu clinical_note cũ của 2 section này.
UPDATE "patient" p
SET "personal_history" = sub.content
FROM (
  SELECT DISTINCT ON (e.patient_id) e.patient_id, cn.content
  FROM "clinical_note" cn
  JOIN "encounter" e ON e.id = cn.encounter_id
  WHERE cn.section = 'PERSONAL_HISTORY' AND cn.deleted_at IS NULL AND cn.content <> ''
  ORDER BY e.patient_id, e.checked_in_at DESC
) sub
WHERE sub.patient_id = p.id;

UPDATE "patient" p
SET "family_history" = sub.content
FROM (
  SELECT DISTINCT ON (e.patient_id) e.patient_id, cn.content
  FROM "clinical_note" cn
  JOIN "encounter" e ON e.id = cn.encounter_id
  WHERE cn.section = 'FAMILY_HISTORY' AND cn.deleted_at IS NULL AND cn.content <> ''
  ORDER BY e.patient_id, e.checked_in_at DESC
) sub
WHERE sub.patient_id = p.id;

-- Xoá dữ liệu clinical_note của 2 section đã chuyển chỗ, rồi bỏ 2 giá trị này khỏi enum (Postgres
-- không hỗ trợ DROP VALUE trực tiếp — cùng kỹ thuật đã dùng ở migration
-- 20260820150000_clinical_note_sections_v2: đổi cột sang TEXT, dựng lại enum, đổi cột trở lại).
DELETE FROM "clinical_note" WHERE "section" IN ('PERSONAL_HISTORY', 'FAMILY_HISTORY');

ALTER TABLE "clinical_note" ALTER COLUMN "section" TYPE TEXT;
DROP TYPE "clinical_note_section";
CREATE TYPE "clinical_note_section" AS ENUM (
  'REASON_FOR_VISIT',
  'ILLNESS_PROGRESS',
  'PRELIMINARY_DIAGNOSIS',
  'GENERAL_EXAM',
  'REGIONAL_EXAM',
  'PLAN'
);
ALTER TABLE "clinical_note" ALTER COLUMN "section" TYPE "clinical_note_section" USING "section"::"clinical_note_section";