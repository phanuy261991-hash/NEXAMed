/**
 * Khoá đếm của từng giới hạn tần suất (docs/DECISIONS.md #258, sửa #244). Hàm thuần nhận `req` của Express — dễ test, và `ThrottlerModule` gắn riêng cho từng giới hạn
 * (`getTracker` theo từng throttler) thay vì một cách tính chung theo IP cho tất cả.
 *
 * Vì sao không chỉ theo IP: nhiều nhân viên một phòng khám dùng chung MỘT IP (router văn phòng ở SaaS; Docker Desktop trên PC Windows che IP máy trạm thành IP cổng mạng Docker).
 * Khoá chỉ theo IP khiến người này làm người khác bị chặn.
 */

/** Tên các giới hạn (khớp `ThrottlerModule` ở `iam.module.ts` và các `@SkipThrottle`). */
export const THROTTLE_LOGIN_ACCOUNT = 'login';
export const THROTTLE_LOGIN_IP = 'login-ip';
export const THROTTLE_PATIENT_LOOKUP = 'patient-lookup';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNKNOWN_TENANT = 'khong-xac-dinh';
const MAX_USERNAME_LENGTH = 100;

interface ThrottleRequest {
  ip?: unknown;
  body?: unknown;
  user?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Mã công ty hợp lệ (UUID) từ người dùng đã xác thực hoặc thân yêu cầu đăng nhập; rác/dài/giả → ô đếm chung `khong-xac-dinh` (không mở rộng bộ nhớ theo chuỗi tuỳ ý). */
function tenantOf(req: ThrottleRequest): string {
  const user = asRecord(req.user);
  const body = asRecord(req.body);
  const raw = typeof user?.tenantId === 'string' ? user.tenantId : typeof body?.tenantId === 'string' ? body.tenantId : null;
  return raw && UUID_PATTERN.test(raw) ? raw.toLowerCase() : UNKNOWN_TENANT;
}

function ipOf(req: ThrottleRequest): string {
  return typeof req.ip === 'string' && req.ip ? req.ip : 'khong-ro-ip';
}

/** Theo IP + công ty — lớp "rải mật khẩu"; trần RỘNG vì IP bị dùng chung. */
export function ipTenantTracker(req: ThrottleRequest): string {
  return `ip|${ipOf(req)}|${tenantOf(req)}`;
}

/** Người dùng ĐÃ xác thực (chỉ khi guard xác thực chạy trước): khoá theo người dùng; ngược lại rơi về IP + công ty. */
export function userTracker(req: ThrottleRequest): string {
  const user = asRecord(req.user);
  if (typeof user?.userId === 'string' && user.userId) return `user|${tenantOf(req)}|${user.userId}`;
  return ipTenantTracker(req);
}

/**
 * Theo TÀI KHOẢN, không phụ thuộc IP. Đã xác thực (xin quyền khẩn cấp...) → theo người dùng; chưa xác thực (đăng nhập) → theo (công ty + tên đăng nhập chuẩn hoá chữ thường,
 * cắt tối đa 100 ký tự). Thiếu tên đăng nhập (thân lỗi) → rơi về IP + công ty để vẫn bị giới hạn.
 */
export function accountTracker(req: ThrottleRequest): string {
  const user = asRecord(req.user);
  if (typeof user?.userId === 'string' && user.userId) return `user|${tenantOf(req)}|${user.userId}`;
  const body = asRecord(req.body);
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase().slice(0, MAX_USERNAME_LENGTH) : '';
  if (!username) return ipTenantTracker(req);
  return `acct|${tenantOf(req)}|${username}`;
}
