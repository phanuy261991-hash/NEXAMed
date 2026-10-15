/**
 * Đọc/ghi file `.env` giữ nguyên chú thích và thứ tự dòng (docs/DECISIONS.md #238). Trình cài đặt chỉ sửa đúng các khoá nó quản lý, KHÔNG ghi lại cả file —
 * người vận hành có thể đã sửa tay các giá trị khác (cổng, thư mục sao lưu) và việc nâng cấp không được làm mất chúng.
 */
const LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

export function parseEnv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const match = LINE.exec(raw);
    if (match) map.set(match[1]!, match[2]!.trim());
  }
  return map;
}

export function getEnvValue(text: string, key: string): string | undefined {
  return parseEnv(text).get(key);
}

/** Thay giá trị khoá đã có (giữ nguyên vị trí và chú thích), khoá chưa có thì thêm cuối file. Giữ kiểu xuống dòng của file gốc. */
export function setEnvValues(text: string, values: Record<string, string>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length > 0 ? text.split(/\r?\n/) : [];
  const remaining = new Map(Object.entries(values));
  const out = lines.map((line) => {
    const match = LINE.exec(line);
    if (match && remaining.has(match[1]!)) {
      const value = remaining.get(match[1]!)!;
      remaining.delete(match[1]!);
      return `${match[1]}=${value}`;
    }
    return line;
  });
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  if (remaining.size > 0) {
    if (out.length > 0) out.push('');
    for (const [key, value] of remaining) out.push(`${key}=${value}`);
  }
  return out.join(eol) + eol;
}
