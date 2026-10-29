/**
 * Soạn nhanh câu dặn cho thuốc kiểu "Khi cần" (docs/DECISIONS.md #267, mockup màn 3). Hàm thuần: ghép từ các ô "Liều mỗi lần / Khi / Tối đa / Cách nhau tối thiểu" thành một câu
 * rồi chèn vào ô "Hướng dẫn dùng" — bác sĩ vẫn sửa tay được, KHÔNG lưu thành trường riêng.
 * Ví dụ: "Uống 1,5 gói khi sốt cao > 38,5 độ C kèm đừ, khó chịu, uống tối đa 5 lần / 24 tiếng, mỗi lần cách nhau tối thiểu 4 tiếng."
 */
export interface AsNeededInstructionInput {
  /** Liều mỗi lần đã định dạng ("1,5"). Trống thì bỏ phần liều. */
  amountText: string;
  /** Tên đơn vị đi kèm liều ("gói", "ml"). */
  unitText: string;
  /** Hoàn cảnh dùng thuốc ("sốt cao > 38,5 độ C"). */
  when: string;
  /** Tối đa bao nhiêu lần trong 24 tiếng; trống/0 = không ghi. */
  maxPerDay: number | null;
  /** Hai lần uống cách nhau tối thiểu bao nhiêu tiếng; trống/0 = không ghi. */
  minGapHours: number | null;
}

/** Số lần/tiếng người dùng gõ → số nguyên dương hoặc `null` (trống, 0, âm, không phải số). */
export function parsePositiveInt(text: string): number | null {
  const n = Number(text.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function buildAsNeededInstruction(input: AsNeededInstructionInput): string {
  const when = input.when.trim();
  const amount = input.amountText.trim();
  const unit = input.unitText.trim();
  const head = amount ? `Uống ${amount}${unit ? ` ${unit}` : ''}` : 'Uống';
  const clauses = [when ? `${head} khi ${when}` : head];
  if (input.maxPerDay) clauses.push(`uống tối đa ${input.maxPerDay} lần / 24 tiếng`);
  if (input.minGapHours) clauses.push(`mỗi lần cách nhau tối thiểu ${input.minGapHours} tiếng`);
  return `${clauses.join(', ')}.`;
}

/** Gợi ý hoàn cảnh dùng thuốc cho ô "Khi" — chỉ là gợi ý (ô vẫn gõ tự do). */
export const AS_NEEDED_WHEN_SUGGESTIONS: readonly string[] = [
  'sốt cao > 38,5 độ C kèm đừ, khó chịu',
  'sốt trên 38,5 độ C',
  'đau, khó chịu',
  'ho nhiều',
  'khó thở, khò khè',
  'ngứa, nổi mẩn',
  'buồn nôn, nôn',
];
