-- Mở rộng hồ sơ hành chính bệnh nhân (docs/DECISIONS.md #034) — 11 cột nullable, không backfill,
-- không đổi RLS/unique/FK hiện có (grant SELECT/INSERT/UPDATE của nexamed_app đã ở mức bảng,
-- áp dụng tự động cho cột mới). Viết tay (không dùng `prisma migrate dev`, môi trường không có
-- TTY) — cùng cách đã làm ở migration `appointment_lead_capture`.

ALTER TABLE "patient"
  ADD COLUMN "photo_key" TEXT,
  ADD COLUMN "national_id_issued_at" DATE,
  ADD COLUMN "national_id_issued_place" TEXT,
  ADD COLUMN "ethnicity" TEXT,
  ADD COLUMN "nationality" TEXT,
  ADD COLUMN "occupation" TEXT,
  ADD COLUMN "insurance_number" TEXT,
  ADD COLUMN "relative_full_name" TEXT,
  ADD COLUMN "relative_relationship" TEXT,
  ADD COLUMN "relative_phone" TEXT,
  ADD COLUMN "relative_address" TEXT;
