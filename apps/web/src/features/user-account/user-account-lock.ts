import type { UserAccountSummary } from '@nexamed/shared';

/**
 * Nhãn "bị khoá do đăng nhập sai" ở danh sách tài khoản (docs/DECISIONS.md #239). Hàm thuần, nhận `now` để test được.
 *
 * - `PERMANENT` → "Khoá vĩnh viễn" (đỏ), chờ quản trị mở khoá.
 * - `TEMPORARY` → "Khoá N phút" (cam), N = số phút còn lại làm tròn LÊN (còn 10 giây vẫn hiện 1 phút). Nếu mốc hết khoá đã qua
 *   (danh sách nạp từ lâu) thì coi như không còn khoá — máy chủ cũng không chặn nữa, nên không hiện nút "Mở khoá" thừa.
 * - `NONE` → `null`.
 */
export interface LockBadge {
  tone: 'warning' | 'danger';
  text: string;
}

export function getLockBadge(item: Pick<UserAccountSummary, 'lockStatus' | 'lockedUntil'>, now: Date): LockBadge | null {
  if (item.lockStatus === 'PERMANENT') return { tone: 'danger', text: 'Khoá vĩnh viễn' };
  if (item.lockStatus === 'TEMPORARY' && item.lockedUntil) {
    const remainingMs = new Date(item.lockedUntil).getTime() - now.getTime();
    if (remainingMs <= 0) return null;
    return { tone: 'warning', text: `Khoá ${Math.max(1, Math.ceil(remainingMs / 60_000))} phút` };
  }
  return null;
}
