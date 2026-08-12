-- S2-09b (docs/DECISIONS.md #032) — đổi mô hình đặt lịch: không tạo/gắn `patient` lúc đặt, chỉ
-- ghi nhận Tên/SĐT/lý do khám trực tiếp trên `appointment` ("lead capture"), có mã đặt lịch
-- (`booking_code`, khách trình lúc đến). `patient_id` chuyển nullable — để sẵn cho Tiếp nhận
-- (Sprint 3) gắn hồ sơ `patient` thật lúc check-in.
--
-- Viết tay (không dùng `prisma migrate diff`): bảng `appointment` có exclusion constraint GiST
-- (`appointment_doctor_slot_excl`, migration *_appointment_s2_05) không khai báo trong
-- schema.prisma — `migrate diff` từng đề xuất DROP nhầm các đối tượng raw-SQL-only kiểu này ở
-- các migration trước (*_patient_search_s2_02, *_user_role_partial_unique_s2_07), viết tay để
-- chắc chắn không đụng tới.

-- 1) Thêm cột mới, nullable trước (còn dữ liệu dev cũ chưa có giá trị).
ALTER TABLE "appointment" ADD COLUMN "booking_code" TEXT;
ALTER TABLE "appointment" ADD COLUMN "full_name" TEXT;
ALTER TABLE "appointment" ADD COLUMN "phone" TEXT;
ALTER TABLE "appointment" ADD COLUMN "reason" TEXT;

-- 2) Backfill dữ liệu dev hiện có từ patient đã gắn (mọi dòng trước migration này đều có patient_id).
UPDATE "appointment" a
SET "full_name" = p."full_name",
    "phone" = p."phone"
FROM "patient" p
WHERE a."patient_id" = p."id" AND a."tenant_id" = p."tenant_id" AND a."full_name" IS NULL;

-- Backfill mã đặt lịch tạm cho dòng cũ (không đi qua code_sequence — chỉ dữ liệu dev/test).
-- Dùng nguyên UUID (không cắt 8 ký tự đầu): id UUID v7 sinh liên tiếp trong cùng 1ms có thể trùng
-- 8 ký tự đầu (encode mốc mili-giây) — gặp thật lúc chạy migration (23505 duplicate key) vì nhiều
-- lịch hẹn dev tạo dồn dập qua script.
UPDATE "appointment" SET "booking_code" = 'LH-LEGACY-' || "id"::text WHERE "booking_code" IS NULL;
UPDATE "appointment" SET "full_name" = '' WHERE "full_name" IS NULL;
UPDATE "appointment" SET "phone" = '' WHERE "phone" IS NULL;

-- 3) Bắt buộc NOT NULL sau khi đã backfill đủ.
ALTER TABLE "appointment" ALTER COLUMN "booking_code" SET NOT NULL;
ALTER TABLE "appointment" ALTER COLUMN "full_name" SET NOT NULL;
ALTER TABLE "appointment" ALTER COLUMN "phone" SET NOT NULL;

-- 4) patient_id không còn bắt buộc lúc tạo lịch.
ALTER TABLE "appointment" ALTER COLUMN "patient_id" DROP NOT NULL;

-- 5) Ràng buộc + index mới.
CREATE UNIQUE INDEX "appointment_tenant_id_booking_code_key" ON "appointment" ("tenant_id", "booking_code");
CREATE INDEX "appointment_tenant_id_phone_idx" ON "appointment" ("tenant_id", "phone");
