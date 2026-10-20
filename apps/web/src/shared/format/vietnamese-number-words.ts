const DIGIT = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const GROUP_UNIT = ['', 'nghìn', 'triệu', 'tỷ'];

/** Đọc một nhóm 3 chữ số (0-999). `full` = nhóm đứng sau một nhóm lớn hơn khác 0 → đọc đủ "không trăm", "lẻ". */
function readTriple(n: number, full: boolean): string {
  const hundred = Math.floor(n / 100);
  const ten = Math.floor((n % 100) / 10);
  const unit = n % 10;
  const parts: string[] = [];
  if (hundred > 0 || full) parts.push(`${DIGIT[hundred]} trăm`);
  if (ten === 0) {
    if (unit > 0) parts.push(hundred > 0 || full ? `lẻ ${DIGIT[unit]}` : DIGIT[unit]!);
  } else if (ten === 1) {
    parts.push('mười');
    if (unit > 0) parts.push(unit === 5 ? 'lăm' : DIGIT[unit]!);
  } else {
    parts.push(`${DIGIT[ten]} mươi`);
    if (unit === 1) parts.push('mốt');
    else if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(DIGIT[unit]!);
  }
  return parts.join(' ');
}

/**
 * Đọc số nguyên không âm thành chữ tiếng Việt ("6" → "sáu", "21" → "hai mươi mốt", "1005" → "một nghìn không trăm lẻ năm").
 * Dùng cho "số lượng thuốc gây nghiện phải viết bằng chữ" trên đơn thuốc "N" (Thông tư 52/2017/TT-BYT). Số lẻ được làm tròn LÊN (khớp cách
 * tính số lượng phát thuốc); chỉ hỗ trợ tới hàng trăm tỷ — vượt quá thì trả chuỗi số để không in sai.
 */
export function numberToVietnameseWords(value: number): string {
  if (!Number.isFinite(value) || value < 0) return String(value);
  const n = Math.ceil(value);
  if (n === 0) return DIGIT[0]!;
  if (n >= 1e12) return String(n);
  const groups: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 1000)) groups.push(rest % 1000);
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (g === 0) continue;
    const isLeading = words.length === 0;
    words.push(readTriple(g, !isLeading), ...(GROUP_UNIT[i] ? [GROUP_UNIT[i]!] : []));
  }
  return words.join(' ');
}

/** "Sáu viên" — số lượng bằng chữ kèm đơn vị, chữ đầu viết hoa. `unitLabel` rỗng thì chỉ có số. */
export function quantityInWords(quantity: number, unitLabel: string): string {
  const text = [numberToVietnameseWords(quantity), unitLabel.trim().toLocaleLowerCase('vi-VN')].filter(Boolean).join(' ');
  return text.charAt(0).toLocaleUpperCase('vi-VN') + text.slice(1);
}
