/**
 * Viết tắt tối đa 2 ký tự cho avatar tròn (`TopBar.tsx`, `MyAccountDialog.tsx`) — tách ra dùng
 * chung từ lần dùng thứ hai (CLAUDE.md). Bỏ từ không bắt đầu bằng chữ cái (ví dụ hậu tố "(dev)"
 * của tài khoản seed) trước khi lấy viết tắt.
 */
export function getInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (words.length === 0) return '?';
  const picked = words.length >= 2 ? [words[0], words[words.length - 1]] : [words[0]];
  return picked.map((w) => (w ?? '').charAt(0).toUpperCase()).join('');
}