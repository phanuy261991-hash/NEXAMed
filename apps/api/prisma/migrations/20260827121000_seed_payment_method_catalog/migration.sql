-- 2 hình thức thanh toán mặc định (Tiền mặt/Chuyển khoản) — giữ đúng code cũ ('CASH'/
-- 'BANK_TRANSFER') để dữ liệu payment/invoice hiện có resolve đúng tên hiển thị, không "legacy
-- value" mồ côi. clinic_admin quản lý tiếp (thêm/sửa/ẩn) qua "Danh mục dùng chung" → pill
-- "Hình thức thanh toán".
INSERT INTO "reference_catalog" (category, code, name, sort_order, is_active)
VALUES
  ('PAYMENT_METHOD', 'CASH', 'Tiền mặt', 0, true),
  ('PAYMENT_METHOD', 'BANK_TRANSFER', 'Chuyển khoản', 1, true);
