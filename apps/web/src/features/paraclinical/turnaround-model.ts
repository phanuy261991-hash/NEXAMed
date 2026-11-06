/**
 * "Thời gian trả kết quả" của dịch vụ kỹ thuật (cột `turnaround_minutes`, luôn lưu bằng PHÚT) nhập được theo phút hoặc theo giờ (docs/DECISIONS.md #291: dịch vụ gửi đối tác trả kết quả
 * theo giờ). Chuyển đổi chỉ ở giao diện; máy chủ và báo cáo vẫn dùng phút.
 */
export type TurnaroundUnit = 'minute' | 'hour';

/** Trần của máy chủ (`technicalServiceFieldsSchema`): 30 ngày. */
export const MAX_TURNAROUND_MINUTES = 60 * 24 * 30;

/** Dạng hiển thị ban đầu của một giá trị đã lưu: tròn giờ thì hiện theo giờ, còn lại theo phút. */
export function splitTurnaround(minutes: number | null | undefined): { unit: TurnaroundUnit; text: string } {
  if (!minutes || minutes <= 0) return { unit: 'minute', text: '' };
  if (minutes % 60 === 0) return { unit: 'hour', text: String(minutes / 60) };
  return { unit: 'minute', text: String(minutes) };
}

/** Đổi số đang hiện khi người dùng đổi đơn vị — giữ nguyên thời lượng thật khi quy đổi được, không thì xoá ô để nhập lại. */
export function convertTurnaroundText(text: string, from: TurnaroundUnit, to: TurnaroundUnit): string {
  if (from === to) return text;
  const parsed = parseTurnaround(text, from);
  if (parsed.minutes === undefined) return '';
  if (to === 'minute') return String(parsed.minutes);
  return parsed.minutes % 60 === 0 ? String(parsed.minutes / 60) : String(Math.round((parsed.minutes / 60) * 100) / 100).replace('.', ',');
}

/**
 * Đọc ô nhập thành số phút. Ô trống = chưa đặt (`minutes` undefined, không lỗi). Theo phút: số nguyên dương. Theo giờ: số dương, cho phép phần lẻ (dấu phẩy hoặc chấm, tối đa 2 chữ số)
 * và làm tròn về phút. Vượt 30 ngày hoặc không đọc được thì trả `error` tiếng Việt.
 */
export function parseTurnaround(text: string, unit: TurnaroundUnit): { minutes?: number; error?: string } {
  const raw = text.trim();
  if (raw === '') return {};
  if (unit === 'minute') {
    if (!/^\d+$/.test(raw)) return { error: 'Thời gian trả kết quả phải là số phút nguyên dương.' };
    const minutes = Number(raw);
    if (minutes <= 0) return { error: 'Thời gian trả kết quả phải là số phút nguyên dương.' };
    if (minutes > MAX_TURNAROUND_MINUTES) return { error: 'Thời gian trả kết quả tối đa 30 ngày.' };
    return { minutes };
  }
  if (!/^\d+([.,]\d{1,2})?$/.test(raw)) return { error: 'Thời gian trả kết quả phải là số giờ, ví dụ 24 hoặc 1,5.' };
  const hours = Number(raw.replace(',', '.'));
  const minutes = Math.round(hours * 60);
  if (minutes <= 0) return { error: 'Thời gian trả kết quả phải lớn hơn 0.' };
  if (minutes > MAX_TURNAROUND_MINUTES) return { error: 'Thời gian trả kết quả tối đa 30 ngày.' };
  return { minutes };
}
