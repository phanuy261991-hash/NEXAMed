-- "Quy cách đóng gói" trên `drug` — đảo ngược hoãn ở docs/DECISIONS.md #151 (chốt lại 17/09/2026).
-- Chuỗi mô tả đóng gói (ví dụ "Hộp 10 vỉ x 10 viên"), có gợi ý tự động ghép từ Bảng quy đổi đơn vị
-- ở tầng ứng dụng lúc lưu (không lưu công thức, chỉ lưu chuỗi kết quả), người dùng sửa tự do được.
ALTER TABLE "drug" ADD COLUMN "packaging_spec" TEXT;
