import type { InteropTokenState } from '@nexamed/shared';

/**
 * Cách hiện token đăng nhập cổng ở trang "Liên thông đơn thuốc" (mockup 8d). Hàm thuần để test được. Token KHÔNG BAO GIỜ hiện ra — chỉ giờ đăng nhập, hạn dự kiến (giờ nhận + 7 ngày, cổng không trả hạn)
 * và trạng thái.
 */
export type TokenBadgeTone = 'success' | 'warning' | 'danger' | 'neutral';

const DAY_MS = 86_400_000;

const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Ghép tay từng phần để định dạng không phụ thuộc bản ICU của máy (`dd/MM`, `dd/MM HH:mm`), giờ Việt Nam. */
function vnParts(iso: string): { day: string; month: string; hour: string; minute: string } {
  const get = (type: string) => parts.formatToParts(new Date(iso)).find((p) => p.type === type)?.value ?? '';
  return { day: get('day'), month: get('month'), hour: get('hour'), minute: get('minute') };
}

/** `14/10 12:50` */
function formatDayMonthTime(iso: string): string {
  const p = vnParts(iso);
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/** `21/10` */
function formatDayMonth(iso: string): string {
  const p = vnParts(iso);
  return `${p.day}/${p.month}`;
}

export interface FacilityTokenView {
  /** Dòng chính ("Đăng nhập 14/10 12:50") — `null` khi chưa có token. */
  primary: string | null;
  /** Dòng phụ ("hết hạn dự kiến 21/10 (7 ngày)"). */
  secondary: string | null;
  badge: { tone: TokenBadgeTone; label: string };
}

/** Cột "Token" + "Trạng thái" của bảng cơ sở. `hasCredential` = đã nhập mã + mật khẩu cơ sở. */
export function describeFacilityToken(token: InteropTokenState, hasCredential: boolean): FacilityTokenView {
  if (!hasCredential) return { primary: null, secondary: null, badge: { tone: 'neutral', label: 'Chưa cấu hình' } };
  if (token.status === 'NONE' || !token.issuedAt || !token.expiresAt) return { primary: null, secondary: null, badge: { tone: 'neutral', label: 'Chưa đăng nhập' } };
  const primary = `Đăng nhập ${formatDayMonthTime(token.issuedAt)}`;
  const secondary = `hết hạn dự kiến ${formatDayMonth(token.expiresAt)} (7 ngày)`;
  switch (token.status) {
    case 'VALID':
      return { primary, secondary, badge: { tone: 'success', label: 'Còn hạn' } };
    case 'EXPIRING':
      return { primary, secondary, badge: { tone: 'warning', label: 'Sắp hết hạn' } };
    default:
      return { primary, secondary, badge: { tone: 'danger', label: 'Hết hạn' } };
  }
}

/** Cột "Token" của bảng bác sĩ: "còn khoảng 6 ngày" / "còn dưới 1 ngày" / "đã hết hạn" / "—". */
export function describeDoctorToken(token: InteropTokenState): string {
  if (token.status === 'NONE') return '—';
  if (token.status === 'EXPIRED') return 'đã hết hạn';
  if (token.remainingMs < DAY_MS) return 'còn dưới 1 ngày';
  return `còn khoảng ${Math.round(token.remainingMs / DAY_MS)} ngày`;
}
