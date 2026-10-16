-- Khoá đăng nhập luỹ tiến → vĩnh viễn cho nhân viên phòng khám (docs/DECISIONS.md #239).
-- Forward-only, chỉ thêm cột. Tài khoản hiện có giữ bậc 0 và không bị khoá vĩnh viễn.
-- `platform_operator` KHÔNG thêm cột: người vận hành khoá cố định 60 phút (đã có xác thực 2 lớp).

ALTER TABLE "user_account"
  ADD COLUMN "lockout_level" SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN "locked_permanently_at" TIMESTAMPTZ(6);

-- Bậc khoá tạm liên tiếp: 0 (chưa khoá) đến 3 (đã chịu đủ 5/15/30 phút). Giữ khớp STAFF_LOCK_STEPS_MINUTES (packages/core).
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_lockout_level_check" CHECK ("lockout_level" BETWEEN 0 AND 3);
