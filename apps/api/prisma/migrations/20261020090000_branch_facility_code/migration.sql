-- Mã đơn thuốc theo Bộ Y tế, Giai đoạn 1 (docs/DECISIONS.md #242): mã cơ sở khám chữa bệnh (5 chữ số) THEO CHI NHÁNH.
-- Là 5 ký tự đầu của mã đơn `xxxxxyyyyyyy-z`. NULL = chi nhánh chưa nhập, dùng `tenant.facility_code` (mã công ty) nếu hợp lệ.
-- Không backfill: hành vi hiện tại không đổi (chế độ "Chuẩn Bộ Y tế" mặc định tắt). Forward-only.
ALTER TABLE "branch" ADD COLUMN "facility_code" TEXT;
ALTER TABLE "branch" ADD CONSTRAINT "branch_facility_code_format_check" CHECK ("facility_code" IS NULL OR "facility_code" ~ '^[0-9]{5}$');
