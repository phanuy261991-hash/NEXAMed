/**
 * Phần THUẦN của trang báo cáo "Bệnh nhân" (docs/DECISIONS.md #287): nhãn, định dạng số. Không gọi API, không biết gì về giao diện — để test được và dùng chung cho màn hình và bản in.
 * Web không import giá trị từ `@nexamed/shared`/`core` nên các nhãn khai báo cục bộ.
 */

/** "09/2026" từ `2026-09`. */
export function formatMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${m[2]}/${m[1]}` : month;
}

/** Kết quả một lần nhắc tái khám → nhãn; mã lạ hiện nguyên mã (không bịa nhãn). */
const REMINDER_LABEL: Record<string, string> = {
  REACHED: 'Đã liên lạc được',
  NO_ANSWER: 'Không nghe máy',
  CALL_BACK_LATER: 'Hẹn gọi lại',
  NOT_RETURNING: 'Bệnh nhân không tái khám',
};

export function reminderLabel(result: string | null): string {
  return result === null ? 'Chưa nhắc' : (REMINDER_LABEL[result] ?? result);
}

/** Màu chữ của kết quả nhắc: chưa nhắc → hổ phách (việc cần làm), không tái khám → xám, còn lại thường. */
export function reminderToneClass(result: string | null): string {
  if (result === null) return 'text-amber-700';
  if (result === 'NOT_RETURNING') return 'text-slate-600';
  return 'text-slate-800';
}

/** Tỉ lệ phần trăm của `part` trên `whole`, một chữ số thập phân; `whole` ≤ 0 → `null`. */
export function shareOf(part: number, whole: number): number | null {
  return whole <= 0 ? null : Math.round((part / whole) * 1000) / 10;
}

/** Số thập phân một chữ số kiểu Việt ("1,5"); `null` → "—". */
export function formatDecimal(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
}

/** Đường dẫn "Xem" của một bệnh nhân: mở hồ sơ bệnh nhân. */
export function patientProfileLink(patientId: string): string {
  return `/patients/${patientId}`;
}
