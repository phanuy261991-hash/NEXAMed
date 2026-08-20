-- Mã Khoa/Phòng tự sinh (yêu cầu chủ dự án 2026-08-20) — cùng khuôn patient_code/employee_code
-- (CodeSequenceRepository, prefix "KP"), không nhập tay. Nullable: phòng ban tạo trước tính năng
-- này (kể cả trong lúc dev/test hôm nay) không backfill.
ALTER TABLE "department"
  ADD COLUMN "code" TEXT;