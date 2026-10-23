-- Khoá đăng nhập THÔNG MINH theo "máy quen" (docs/DECISIONS.md #259, sửa #239).
--
-- Vấn đề: khoá luỹ tiến → vĩnh viễn (#239) chặn dò mật khẩu nhưng cũng là CÁCH TÊ LIỆT tài khoản — ai biết tên đăng nhập, gõ sai ~20 lần là khoá vĩnh viễn được tài khoản của người khác
-- (kể cả quản trị), chỉ cần ở trong LAN (on-prem) hoặc biết mã công ty + tên đăng nhập (SaaS).
-- Cách xử lý (kiểu "smart lockout"): trình duyệt đã từng đăng nhập ĐÚNG tài khoản giữ một dấu hiệu "máy quen" (cookie ký, xem DeviceTrustService). Khoá do máy LẠ gây ra chỉ chặn máy lạ; máy quen vẫn
-- đăng nhập được và đăng nhập đúng thì gỡ khoá. Đăng nhập SAI từ máy quen đếm RIÊNG bằng 3 cột dưới đây (khoá tạm 15 phút, KHÔNG BAO GIỜ vĩnh viễn) để dấu hiệu bị đánh cắp cũng không dò mật khẩu vô hạn được.
-- Cột khoá cũ (failed_login_count, locked_until, lockout_level, locked_permanently_at) giữ nguyên ý nghĩa: đếm đăng nhập sai từ máy LẠ. Forward-only.

ALTER TABLE "user_account"
  ADD COLUMN "familiar_failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "familiar_last_failed_login_at" TIMESTAMPTZ(6),
  ADD COLUMN "familiar_locked_until" TIMESTAMPTZ(6);

ALTER TABLE "user_account"
  ADD CONSTRAINT "user_account_familiar_failed_login_count_check" CHECK ("familiar_failed_login_count" >= 0);
