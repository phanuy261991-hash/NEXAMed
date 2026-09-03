-- Khoa/Phòng "tham gia Hàng đợi khám" — tách khỏi department_type (THUẦN mô tả/tổ chức, #063).
-- Bug thật: GET /departments/options (điều phối Tiếp nhận, #064) trả VỀ MỌI Khoa/Phòng isActive,
-- không phân biệt Khoa lâm sàng và bộ phận hành chính (ví dụ "Bộ phận Lễ Tân") — lộ ra khi chủ dự
-- án thêm Khoa/Phòng hành chính đầu tiên. Không dùng department_type để lọc vì tuỳ chọn/thuần mô
-- tả, dựa vào tên loại sẽ dễ vỡ ngầm khi đổi tên (đúng bài học deactivates_account #063, tách
-- khỏi department_type.code có thể sửa qua UI). Mặc định TRUE — giữ nguyên hành vi hiện có cho
-- mọi Khoa/Phòng đã tồn tại (kể cả "Khoa chung" tự sinh #064, luôn phải tham gia hàng đợi).
ALTER TABLE "department" ADD COLUMN "participates_in_queue" BOOLEAN NOT NULL DEFAULT true;
