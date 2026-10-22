/**
 * Phân trang theo KHOÁ (keyset) trên một danh sách ĐÃ SẮP XẾP tăng dần theo `(sortKey, id)` — dùng cho hai danh sách trong ngày "Bệnh nhân trong ngày" và "Thu ngân"
 * (docs/DECISIONS.md #251). Con trỏ ghi lại phần tử cuối của trang trước, không phải số thứ tự: dòng mới phát sinh trong lúc người dùng cuộn (bệnh nhân vừa tiếp nhận) không làm
 * trùng hay sót dòng ở các lần tải sau, khác kiểu `offset`. Hàm thuần, không phụ thuộc framework.
 */

export interface KeysetPosition {
  sortKey: string;
  id: string;
}

/** Con trỏ gửi cho client: chuỗi không trong suốt (base64url của `[sortKey, id]`), client chỉ gửi lại nguyên văn. */
export function encodeKeysetCursor(position: KeysetPosition): string {
  return Buffer.from(JSON.stringify([position.sortKey, position.id]), 'utf8').toString('base64url');
}

/** `null` nếu chuỗi không phải con trỏ hợp lệ (nơi gọi trả 400, không đoán). */
export function decodeKeysetCursor(cursor: string): KeysetPosition | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { sortKey: parsed[0], id: parsed[1] };
    }
    return null;
  } catch {
    return null;
  }
}

function isAfter(position: KeysetPosition, cursor: KeysetPosition): boolean {
  if (position.sortKey !== cursor.sortKey) return position.sortKey > cursor.sortKey;
  return position.id > cursor.id;
}

/**
 * Lấy tối đa `limit` phần tử đứng SAU `cursor` (hoặc từ đầu khi không có). `nextCursor` là `null` khi đã hết danh sách; có khi còn ít nhất một phần tử sau trang này.
 * `items` PHẢI đã sắp tăng dần theo `(sortKey, id)` đúng như `keyOf` mô tả.
 */
export function pageAfterCursor<T>(
  items: readonly T[],
  keyOf: (item: T) => KeysetPosition,
  params: { limit: number; cursor?: KeysetPosition | null },
): { page: T[]; nextCursor: string | null } {
  const { limit, cursor } = params;
  let start = 0;
  if (cursor) {
    // Tìm nhị phân phần tử đầu tiên sau con trỏ (danh sách đã sắp).
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (isAfter(keyOf(items[mid]!), cursor)) hi = mid;
      else lo = mid + 1;
    }
    start = lo;
  }
  const page = items.slice(start, start + limit);
  const hasMore = start + limit < items.length;
  const last = page[page.length - 1];
  return { page, nextCursor: hasMore && last !== undefined ? encodeKeysetCursor(keyOf(last)) : null };
}
