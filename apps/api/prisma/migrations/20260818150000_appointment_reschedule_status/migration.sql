-- Dời lịch (2026-08-18, yêu cầu chủ dự án): "Sửa lịch hẹn" tại chỗ (PATCH, S2-09) thay bằng tạo
-- MỘT lịch hẹn mới cho ngày/giờ mới, lịch cũ chuyển sang trạng thái RESCHEDULED (không sửa/xoá).
-- Cột tự trỏ `rescheduled_from_id` trên lịch MỚI trỏ về lịch CŨ — cùng hướng và cùng cách xử lý
-- (không unique constraint) với `prescription.supersedes_id`/`patient.merged_into_id`.
--
-- ALTER TYPE ... ADD VALUE không dùng giá trị mới ngay trong CÙNG migration này (không insert/
-- update dòng nào dùng nó) nên an toàn chạy trong 1 transaction — cùng lý do đã ghi ở migration
-- 20260813160000_reception_direct_and_catalog_extension.

ALTER TYPE "appointment_status" ADD VALUE 'RESCHEDULED';

ALTER TABLE "appointment" ADD COLUMN "rescheduled_from_id" UUID;

ALTER TABLE "appointment"
  ADD CONSTRAINT "appointment_tenant_id_rescheduled_from_id_fkey"
  FOREIGN KEY ("tenant_id", "rescheduled_from_id") REFERENCES "appointment"("tenant_id", "id");