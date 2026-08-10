/**
 * TTL token — xem .claude/docs/security-audit.md ("JWT access token 15 phút + refresh token
 * httpOnly cookie"). Thời hạn refresh token chưa có con số chốt trong tài liệu — 30 ngày là
 * giả định hợp lý cho ứng dụng nội bộ nhân viên phòng khám, dễ đổi vì chỉ là hằng số.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
