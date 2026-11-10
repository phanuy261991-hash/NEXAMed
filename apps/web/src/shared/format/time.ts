/** "HH:mm" giờ Việt Nam — dùng cho chip/badge trạng thái "Tạm nghỉ / Đóng ca" (TopBar, board điều
 * phối lễ tân) — dùng chung ở ≥2 nơi nên trích xuất thay vì lặp lại `toLocaleTimeString` từng chỗ. */
export function formatClockTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
}

/** "06/10 09:12" (ngày/tháng giờ:phút) theo giờ Việt Nam — cột "Trả lúc" gọn trong bảng. */
export function formatShortDateTimeVn(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`;
}

/** "06/10/2026 08:41" theo giờ Việt Nam (UTC+7 cố định) — mốc thời gian trên phiếu kết quả, trạng thái sao lưu... */
export function formatDateTimeVn(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`;
}

/** Ngày "YYYY-MM-DD" và giờ "HH:mm" theo giờ Việt Nam của một mốc thời gian — để điền sẵn ô ngày + ô giờ (mặc định "bây giờ"). */
export function toVnDateAndTime(at: Date | string = new Date()): { date: string; time: string } {
  const vn = new Date(new Date(at).getTime() + 7 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}`, time: `${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}` };
}

/** Ngược lại với `toVnDateAndTime`: ghép ngày "YYYY-MM-DD" + giờ "HH:mm" (giờ Việt Nam) thành mốc ISO UTC; `null` nếu chuỗi không hợp lệ. Việt Nam không có giờ mùa hè nên độ lệch cố định. */
export function vnDateAndTimeToIso(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]) - 7, Number(t[2]));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
