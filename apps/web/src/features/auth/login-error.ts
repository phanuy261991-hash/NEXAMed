import { ApiError, isNetworkError } from '../../shared/api/client';

/**
 * Phân loại lỗi đăng nhập để màn hình hiện đúng khung/ngôn từ (docs/DECISIONS.md #239 + mockup đăng nhập đã duyệt). Hàm thuần, nhận `now` để test được.
 *
 * - `locked`: khoá TẠM — web đếm lùi tới `endsAt`. Ưu tiên số giây TƯƠNG ĐỐI do máy chủ trả (`retryAfterSeconds`) để không lệch đồng hồ giữa máy khách và máy chủ.
 * - `permanent`: khoá vĩnh viễn, chờ quản trị viên mở khoá.
 * - `rate`: máy chủ giới hạn số lần thử theo địa chỉ mạng (HTTP 429, mã `TOO_MANY_REQUESTS`).
 */
export type LoginFailure =
  | { kind: 'wrong'; message: string }
  | { kind: 'locked'; endsAt: Date; minutes: number }
  | { kind: 'permanent'; message: string }
  | { kind: 'rate'; message: string }
  | { kind: 'suspended'; message: string }
  | { kind: 'network'; message: string }
  | { kind: 'other'; message: string };

const FALLBACK_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại.';
export const RATE_LIMIT_MESSAGE = 'Bạn đã thử đăng nhập quá nhiều lần trong thời gian ngắn. Vui lòng đợi khoảng 1 phút rồi thử lại.';
export const NETWORK_MESSAGE = 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';

function lockSecondsFrom(details: unknown, now: Date): number | null {
  if (typeof details !== 'object' || details === null) return null;
  const d = details as { retryAfterSeconds?: unknown; retryAfterMinutes?: unknown; lockedUntil?: unknown };
  if (typeof d.retryAfterSeconds === 'number' && d.retryAfterSeconds > 0) return Math.ceil(d.retryAfterSeconds);
  if (typeof d.retryAfterMinutes === 'number' && d.retryAfterMinutes > 0) return Math.ceil(d.retryAfterMinutes * 60);
  if (typeof d.lockedUntil === 'string') {
    const until = new Date(d.lockedUntil).getTime();
    if (!Number.isNaN(until) && until > now.getTime()) return Math.ceil((until - now.getTime()) / 1000);
  }
  return null;
}

export function classifyLoginError(err: unknown, now: Date = new Date()): LoginFailure {
  if (isNetworkError(err)) return { kind: 'network', message: NETWORK_MESSAGE };
  const apiError = err as ApiError;
  switch (apiError.code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return { kind: 'wrong', message: apiError.message };
    case 'AUTH_ACCOUNT_LOCKED': {
      const seconds = lockSecondsFrom(apiError.details, now);
      // Thiếu thông tin thời gian (không nên xảy ra) → hiện nguyên văn câu của máy chủ thay vì đoán số phút.
      if (seconds === null) return { kind: 'other', message: apiError.message };
      return { kind: 'locked', endsAt: new Date(now.getTime() + seconds * 1000), minutes: Math.max(1, Math.ceil(seconds / 60)) };
    }
    case 'AUTH_ACCOUNT_LOCKED_PERMANENT':
      return { kind: 'permanent', message: apiError.message };
    case 'TOO_MANY_REQUESTS':
      return { kind: 'rate', message: RATE_LIMIT_MESSAGE };
    case 'TENANT_SUSPENDED':
      return { kind: 'suspended', message: apiError.message };
    default:
      return { kind: 'other', message: apiError.message || FALLBACK_MESSAGE };
  }
}

/** Số giây còn lại tới `endsAt` (làm tròn LÊN, không âm). */
export function secondsRemaining(endsAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 1000));
}

/** `mm:ss` — ví dụ 292 → `04:52`. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
