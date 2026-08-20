-- Đổi 4 mục SOAP (S/O/A/P) của clinical_note.section sang 8 mục nhóm "Tiền sử"/"Thăm khám" — yêu
-- cầu chủ dự án 2026-08-20 (xem docs/DECISIONS.md). Viết tay (không `prisma migrate diff`, cùng lý
-- do mọi migration trước có enum/partial unique index).
--
-- Xoá sạch dữ liệu clinical_note hiện có trước khi đổi enum: chỉ có dữ liệu demo/test trên máy dev
-- (dự án chưa có tenant production nào, xem docs/DECISIONS.md #037), không có dữ liệu thật cần giữ
-- lại theo khuôn 4 mục cũ.
DELETE FROM "clinical_note";

ALTER TABLE "clinical_note" ALTER COLUMN "section" TYPE TEXT;
DROP TYPE "clinical_note_section";
CREATE TYPE "clinical_note_section" AS ENUM (
  'PERSONAL_HISTORY',
  'FAMILY_HISTORY',
  'REASON_FOR_VISIT',
  'ILLNESS_PROGRESS',
  'PRELIMINARY_DIAGNOSIS',
  'GENERAL_EXAM',
  'REGIONAL_EXAM',
  'PLAN'
);
ALTER TABLE "clinical_note" ALTER COLUMN "section" TYPE "clinical_note_section" USING "section"::"clinical_note_section";