/**
 * TTL token — xem .claude/docs/security-audit.md ("JWT access token 15 phút + refresh token
 * httpOnly cookie"). Refresh token **7 ngày** (chủ dự án chốt 21/10/2026, docs/DECISIONS.md #244,
 * giảm từ 30 ngày): nghỉ cuối tuần về vẫn không phải đăng nhập lại, nhưng máy bỏ quên/thất lạc
 * hết hiệu lực sau một tuần thay vì một tháng.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Số phiên đăng nhập còn hiệu lực tối đa cho MỖI tài khoản (chủ dự án chốt 21/10/2026, #244).
 * Vượt quá thì phiên cũ nhất tự bị thu hồi — một người thường chỉ dùng 1-2 máy; không giới hạn thì
 * bảng `user_session` phình vô hạn (đo thật trên máy dev: một tài khoản tích tụ 332 phiên còn hiệu lực).
 */
export const MAX_ACTIVE_SESSIONS_PER_USER = 5;

/**
 * Giữ lại phiên đã hết hạn thêm bao nhiêu ngày trước khi job nền xoá cứng (chủ dự án chốt 21/10/2026, #244)
 * — đủ để còn tra "ai đăng nhập từ máy nào" khi điều tra sự cố, nhưng không giữ mãi.
 */
export const EXPIRED_SESSION_RETENTION_DAYS = 7;
