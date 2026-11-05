/**
 * Phần THUẦN của nhóm báo cáo "Khám bệnh và vận hành" (docs/DECISIONS.md #287): nhãn, định dạng số, màu ô của bản đồ nhiệt. Không gọi API, không biết gì về giao diện — để test được và dùng chung
 * cho màn hình, bản in và các báo cáo sau. Web không import giá trị từ `@nexamed/shared`/`core` nên các nhãn khai báo cục bộ.
 */
export const WEEKDAY_LABEL: Record<number, string> = { 1: 'Thứ Hai', 2: 'Thứ Ba', 3: 'Thứ Tư', 4: 'Thứ Năm', 5: 'Thứ Sáu', 6: 'Thứ Bảy', 7: 'Chủ nhật' };

/** Mã nguồn đặt lịch → nhãn; nguồn lạ hiện nguyên mã (không bịa nhãn). */
export function sourceLabel(source: string, labels: Record<string, string>): string {
  return labels[source] ?? source;
}

/** "14,2%" (dấu phẩy thập phân kiểu Việt); `null` (mẫu số bằng 0) → "—". */
export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${String(value).replace('.', ',')}%`;
}

/** "17 phút"; `null` (chưa đo được) → "—". */
export function formatMinutes(value: number | null): string {
  return value === null ? '—' : `${value} phút`;
}

/** Số có dấu chấm phân cách hàng nghìn (kiểu `vi-VN`). */
export function formatCount(value: number): string {
  return value.toLocaleString('vi-VN');
}

/** "Thứ Hai 9h" cho ô giờ cao điểm. */
export function formatPeak(peak: { isoDow: number; hour: number } | null): string {
  return peak ? `${WEEKDAY_LABEL[peak.isoDow] ?? ''} ${peak.hour}h` : '—';
}

const LOW = [241, 245, 249] as const;
const HIGH = [30, 58, 138] as const;
const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

/**
 * Màu một ô của bản đồ nhiệt (mockup đã duyệt): nội suy tuyến tính từ xám rất nhạt (ít) sang xanh đậm (nhiều) theo `count / max`; chữ trắng khi nền đã đậm (quá nửa thang).
 * `max` bằng 0 (không có lượt nào) → mọi ô là màu nhạt nhất.
 */
export function heatCellStyle(count: number, max: number): { background: string; color: string } {
  const t = max <= 0 ? 0 : Math.min(1, Math.max(0, count / max));
  return {
    background: `rgb(${lerp(LOW[0], HIGH[0], t)}, ${lerp(LOW[1], HIGH[1], t)}, ${lerp(LOW[2], HIGH[2], t)})`,
    color: t > 0.5 ? '#ffffff' : '#1e293b',
  };
}

/** Số lượt lớn nhất của một ô trong bản đồ nhiệt — thang màu lấy theo ô này. */
export function heatMax(days: ReadonlyArray<{ counts: readonly number[] }>): number {
  return days.reduce((max, d) => Math.max(max, ...d.counts), 0);
}

/** Độ rộng thanh (phần trăm 0–100, làm tròn) của `value` so với `max`; `max` ≤ 0 → 0. */
export function barWidthPercent(value: number, max: number): number {
  return max <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, value / max)) * 100);
}

/** "04/11" từ `YYYY-MM-DD` — cột Ngày khám gọn của Sổ khám bệnh. */
export function formatDayMonth(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[2]}/${m[1]}` : date;
}
