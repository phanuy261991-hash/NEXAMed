/**
 * Đọc nội dung lỗi từ phản hồi của cổng Đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3). Tài liệu QĐ 808 chỉ ghi `{ danh_sach_cac_loi }` mà không nêu cấu trúc bên trong, nên hàm này CHỊU được
 * nhiều dạng thay vì giả định một dạng: mảng chuỗi, mảng đối tượng (có `message`/`loi`/`noi_dung`/`error`), đối tượng dạng "tên trường → danh sách lỗi" (kiểu Laravel `{ "ma_thuoc": ["..."] }`),
 * hoặc chỉ `{ message }` / `{ error }` / `{ success }`. Không bao giờ ném lỗi; không đọc được thì trả mảng rỗng. Cắt ngắn để không phình nhật ký/giao diện.
 */
const MAX_ERRORS = 20;
const MAX_LENGTH = 300;

function clip(text: string): string {
  const t = text.trim();
  return t.length > MAX_LENGTH ? `${t.slice(0, MAX_LENGTH - 1)}…` : t;
}

function collect(value: unknown, prefix: string, out: string[], depth: number): void {
  if (out.length >= MAX_ERRORS || depth > 4 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.trim() !== '') out.push(clip(prefix ? `${prefix}: ${value}` : value));
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, prefix, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const direct = ['message', 'loi', 'noi_dung', 'error', 'msg'].find((k) => typeof obj[k] === 'string');
    if (direct) {
      const field = typeof obj.truong === 'string' ? obj.truong : typeof obj.field === 'string' ? obj.field : prefix;
      collect(obj[direct], field, out, depth + 1);
      return;
    }
    for (const [key, inner] of Object.entries(obj)) collect(inner, prefix ? `${prefix}.${key}` : key, out, depth + 1);
  }
}

/** `body` là JSON đã parse (hoặc `undefined` nếu phản hồi không phải JSON). */
export function parseGatewayErrors(body: unknown): string[] {
  const out: string[] = [];
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    if ('danh_sach_cac_loi' in obj) collect(obj.danh_sach_cac_loi, '', out, 0);
    else if ('errors' in obj) collect(obj.errors, '', out, 0);
    else if (typeof obj.message === 'string') collect(obj.message, '', out, 0);
    else if (typeof obj.error === 'string') collect(obj.error, '', out, 0);
    return out;
  }
  collect(body, '', out, 0);
  return out;
}

/** Lấy chuỗi thông báo thành công (`{ success: '...' }`) nếu có. */
export function parseGatewaySuccessMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    const success = (body as Record<string, unknown>).success;
    if (typeof success === 'string') return clip(success);
  }
  return '';
}
