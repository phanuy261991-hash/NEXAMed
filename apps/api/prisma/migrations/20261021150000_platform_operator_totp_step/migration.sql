-- Chống dùng lại mã OTP của người vận hành nền tảng (docs/DECISIONS.md #244, RFC 6238 mục 5.2).
--
-- Mã TOTP 6 số hợp lệ ở 3 bước 30 giây liền nhau (bù đồng hồ lệch) nên một mã bị lộ (lừa đảo, nhìn trộm) dùng lại được ~90 giây.
-- Cột này ghi "số bước thời gian" của mã đã dùng thành công gần nhất; mã chỉ được chấp nhận khi bước của nó LỚN HƠN giá trị đã ghi.
-- Cập nhật bằng MỘT lệnh có điều kiện (không đọc-rồi-ghi) nên hai yêu cầu cùng gửi một mã cùng lúc chỉ một yêu cầu qua.
ALTER TABLE "platform_operator" ADD COLUMN "last_totp_step" BIGINT;
