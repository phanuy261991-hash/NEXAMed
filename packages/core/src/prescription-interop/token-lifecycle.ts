/**
 * Vòng đời token của cổng Đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3, mockup 8d). Cổng chỉ trả `token`, KHÔNG trả hạn; tài liệu nêu hiệu lực 7 ngày nên hạn do hệ thống TỰ TÍNH = giờ nhận token + 7 ngày.
 * Hàm thuần (không đọc đồng hồ, không gọi DB) để test được; nơi gọi truyền `now`.
 */
export const INTEROP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Còn dưới ngưỡng này thì đăng nhập lại TRƯỚC khi dùng (không đợi cổng trả 401). */
export const INTEROP_TOKEN_REFRESH_BEFORE_MS = 24 * 60 * 60 * 1000;

export type InteropTokenStatus =
  /** Chưa từng đăng nhập (hoặc chưa có token). */
  | 'NONE'
  /** Còn hạn, chưa cần làm mới. */
  | 'VALID'
  /** Còn dưới 1 ngày — hệ thống sẽ đăng nhập lại trước lần gọi kế tiếp. */
  | 'EXPIRING'
  | 'EXPIRED';

export interface InteropTokenState {
  status: InteropTokenStatus;
  /** Giờ nhận token (ISO) — `null` khi chưa có. */
  issuedAt: string | null;
  /** Hạn dự kiến (ISO) = giờ nhận + 7 ngày — `null` khi chưa có. */
  expiresAt: string | null;
  /** Số mili giây còn lại (không âm); 0 khi hết hạn hoặc chưa có. */
  remainingMs: number;
}

export function computeInteropTokenState(issuedAt: Date | null | undefined, now: Date): InteropTokenState {
  if (!issuedAt) return { status: 'NONE', issuedAt: null, expiresAt: null, remainingMs: 0 };
  const expires = issuedAt.getTime() + INTEROP_TOKEN_TTL_MS;
  const remainingMs = Math.max(0, expires - now.getTime());
  const status: InteropTokenStatus = remainingMs === 0 ? 'EXPIRED' : remainingMs < INTEROP_TOKEN_REFRESH_BEFORE_MS ? 'EXPIRING' : 'VALID';
  return { status, issuedAt: issuedAt.toISOString(), expiresAt: new Date(expires).toISOString(), remainingMs };
}

/** Có cần đăng nhập lại trước khi dùng token này không (chưa có, sắp hết hoặc đã hết hạn). */
export function interopTokenNeedsRefresh(issuedAt: Date | null | undefined, now: Date): boolean {
  const { status } = computeInteropTokenState(issuedAt, now);
  return status !== 'VALID';
}
