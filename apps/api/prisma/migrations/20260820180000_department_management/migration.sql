-- Danh mục "Khoa/Phòng" quản lý được qua UI (mở rộng ADM-01, yêu cầu chủ dự án) — Thêm/Sửa/Ẩn,
-- cùng khuôn `room.is_active` (không soft-delete `deleted_at`, giữ nguyên lịch sử gán trên
-- user_account.department_id khi ẩn — chỉ loại khỏi Combobox chọn mới).
ALTER TABLE "department"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;