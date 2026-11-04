/**
 * Chia thang trục tung cho biểu đồ tự vẽ: chọn bước "tròn" (1, 2, 3, 4, 5, 6, 8 × 10^n) sao cho `divisions` khoảng phủ trọn `maxValue` kèm chừa 10% khoảng trống phía trên
 * (đỉnh không dính mép). Không có dữ liệu (max ≤ 0) thì thang 0–`divisions`. Trả về các vạch từ 0 đến mức trần (gồm cả hai đầu).
 */
const NICE_STEPS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

export function niceScale(maxValue: number, divisions = 3, headroom = 1.1): { max: number; ticks: number[] } {
  if (!(maxValue > 0)) return { max: divisions, ticks: Array.from({ length: divisions + 1 }, (_, i) => i) };
  const rawStep = (maxValue * headroom) / divisions;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (NICE_STEPS.find((s) => s >= normalized) ?? 10) * magnitude;
  return { max: step * divisions, ticks: Array.from({ length: divisions + 1 }, (_, i) => step * i) };
}

/** Số triệu đồng cho nhãn trên cột: 18100000 → "18,1"; 600000 → "0,6"; 0 → "0". */
export function formatMillions(amount: number): string {
  if (amount === 0) return '0';
  const millions = Math.round(amount / 100_000) / 10;
  return millions.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
