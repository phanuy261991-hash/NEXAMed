const ROMAN_VALUES: readonly (readonly [string, number])[] = [
  ['M', 1000],
  ['CM', 900],
  ['D', 500],
  ['CD', 400],
  ['C', 100],
  ['XC', 90],
  ['L', 50],
  ['XL', 40],
  ['X', 10],
  ['IX', 9],
  ['V', 5],
  ['IV', 4],
  ['I', 1],
];

/**
 * Chuyển số La Mã (`chapterCode` của `icd10_catalog`, ví dụ "I".."XXII") sang số nguyên để sắp
 * xếp đúng thứ tự Chương — KHÔNG được sắp theo thứ tự chuỗi ("IX" < "V" theo alphabet, sai thứ
 * tự thật 9 > 5). Chỉ dùng cho hiển thị/sắp xếp, không phải một phần của `code` lưu trong DB.
 */
export function romanToInt(roman: string): number {
  let result = 0;
  let i = 0;
  const upper = roman.toUpperCase();
  while (i < upper.length) {
    const two = upper.slice(i, i + 2);
    const twoValue = ROMAN_VALUES.find(([symbol]) => symbol === two);
    if (twoValue) {
      result += twoValue[1];
      i += 2;
      continue;
    }
    const one = upper.slice(i, i + 1);
    const oneValue = ROMAN_VALUES.find(([symbol]) => symbol === one);
    if (!oneValue) {
      throw new Error(`Ký tự số La Mã không hợp lệ: "${roman}"`);
    }
    result += oneValue[1];
    i += 1;
  }
  return result;
}