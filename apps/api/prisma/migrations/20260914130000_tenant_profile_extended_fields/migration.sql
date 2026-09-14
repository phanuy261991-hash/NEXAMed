-- Mở rộng "Thông tin phòng khám" (yêu cầu chủ dự án 2026-09-14): thêm Mã cơ sở khám chữa bệnh,
-- Người chịu trách nhiệm chuyên môn, Website, Mạng xã hội (nhiều dòng), Thông tin tài khoản &
-- Thanh toán. `license_no` đã có sẵn từ trước (chưa từng lộ qua endpoint clinic-profile) — tái
-- dùng cho "Số giấy phép hoạt động", không thêm cột mới. Mọi cột nullable, không kiểm định dạng
-- (đã hỏi và chốt: cùng cách phone/taxCode đang xử lý, không ép URL như email). Không RLS (bảng
-- `tenant` không có tenant_id — chính nó là gốc), không permission mới (dùng lại
-- clinic_config.read/update đã seed sẵn). Viết tay — cùng cách các migration ALTER TABLE trước đó
-- (môi trường không có TTY cho `prisma migrate dev`).

ALTER TABLE "tenant"
  ADD COLUMN "facility_code" TEXT,
  ADD COLUMN "professional_in_charge_name" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "social_links_json" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "bank_account_name" TEXT,
  ADD COLUMN "bank_account_number" TEXT,
  ADD COLUMN "bank_name" TEXT;
