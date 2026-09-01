-- Sửa lỗi thật phát hiện lúc verify quy trình restore từ backup (docs/DECISIONS.md #099, diễn tập
-- phục hồi thật lần đầu — S6-02). nexamed_unaccent_lower() (từ 20260811055006_patient_search_s2_02)
-- gọi unaccent(input) KHÔNG ghi rõ schema — hoạt động bình thường trong dùng hằng ngày (session
-- thường có search_path mặc định "$user", public), nhưng pg_restore CỐ Ý đặt search_path='' trước
-- khi chạy (tính năng bảo mật chính thức của Postgres chống tấn công qua search_path, từ bản vá
-- CVE-2018-1058) — khiến tên unaccent không ghi rõ schema không resolve được, restore từ backup
-- thất bại ngay ở CREATE TABLE patient/icd10_catalog (cả 2 bảng có cột GENERATED dùng hàm này).
-- Sửa bằng ghi rõ public.unaccent(...) — không đổi hành vi/kết quả hàm, chỉ đổi cách resolve tên.
CREATE OR REPLACE FUNCTION nexamed_unaccent_lower(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(replace(replace(public.unaccent(input), 'đ', 'd'), 'Đ', 'D'))
$$;
