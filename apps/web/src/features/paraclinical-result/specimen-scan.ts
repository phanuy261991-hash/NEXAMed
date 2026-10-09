/**
 * Chuẩn hoá mã quét/gõ vào ô "Quét mã ống" (docs/DECISIONS.md #220): súng quét USB gõ mã rồi Enter nên có thể kèm khoảng trắng hoặc ký tự điều khiển. Bản PHẢN CHIẾU của
 * `normalizeScannedSid` ở `packages/core` (web không import được giá trị từ core, #073) — không đổi chữ hoa/thường vì SID do khuôn mẫu của phòng khám quyết định.
 */
export function normalizeScan(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out.trim();
}
