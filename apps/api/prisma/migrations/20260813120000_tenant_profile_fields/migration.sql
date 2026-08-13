-- Cấu hình "Thông tin phòng khám" — mở rộng hồ sơ tenant (yêu cầu chủ dự án 2026-08-13).
-- `name`/`address`/`taxCode` đã có sẵn trên `tenant`; thêm 6 cột: phone/email (nullable, tự do),
-- currency/timezone (NOT NULL với default — luôn có giá trị hiển thị), logo_key/print_logo_key
-- (nullable, khoá lưu trên StoragePort, cùng mẫu patient.photo_key). Không RLS (bảng `tenant`
-- không có tenant_id — chính nó là gốc, xem docs/DECISIONS.md #011), không permission mới (dùng
-- lại clinic_config.read/update đã seed sẵn). Viết tay — cùng cách các migration ALTER TABLE
-- trước đó (môi trường không có TTY cho `prisma migrate dev`).
--
-- currency/timezone chỉ LƯU để hiển thị/chuẩn bị cho sau này — chưa nối vào logic tính toán
-- (viện phí v2+) hay logic ngày giờ hệ thống (vẫn hard-code UTC+7, xem
-- packages/core/src/date/vietnam-day-range.ts) — đã hỏi và chốt với chủ dự án trước khi làm.

ALTER TABLE "tenant"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'VND',
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  ADD COLUMN "logo_key" TEXT,
  ADD COLUMN "print_logo_key" TEXT;
