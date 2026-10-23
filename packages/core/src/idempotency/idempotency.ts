/**
 * Khoá chống ghi trùng (docs/DECISIONS.md #257) — phần THUẦN (không phụ thuộc framework/DB) dùng cho `IdempotencyInterceptor` của API.
 *
 * Cách hoạt động: giao diện gửi header `Idempotency-Key` (UUID) cho mọi POST JSON, giữ nguyên khoá khi bấm lại; máy chủ giữ chỗ khoá trước khi chạy nghiệp vụ rồi lưu phản hồi
 * để trả lại đúng kết quả cũ cho lần gửi lại. Các hằng số dưới đây là chính sách chung, đổi một chỗ.
 */

/** Tên header (không phân biệt hoa/thường ở HTTP; Node đọc ở dạng chữ thường). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Khoá và phản hồi lưu 24 giờ — đủ cho mọi tình huống "bấm lại sau khi mạng đứt"; quá hạn thì job nền xoá. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;

/** Lần gửi đầu coi là "treo" (máy chủ sập giữa chừng) nếu giữ chỗ quá lâu mà chưa xong; lần gửi lại sau mốc này được tiếp quản thay vì chờ mãi. */
export const IDEMPOTENCY_STALE_LOCK_MS = 2 * 60_000;

/** Lần gửi thứ hai trong lúc lần đầu còn chạy sẽ CHỜ tối đa chừng này rồi nhận đúng kết quả của lần đầu; quá hạn mới báo "đang xử lý". */
export const IDEMPOTENCY_WAIT_MS = 20_000;

/** Khoảng cách giữa hai lần kiểm tra khi chờ lần gửi đầu hoàn tất. */
export const IDEMPOTENCY_POLL_INTERVAL_MS = 200;

/** Phản hồi lớn hơn mức này (JSON) không lưu lại — lần gửi lại báo "đã thực hiện, tải lại để xem", KHÔNG ghi thêm. */
export const IDEMPOTENCY_MAX_RESPONSE_BYTES = 512 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidIdempotencyKey(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * JSON.stringify với khoá đối tượng được sắp xếp đệ quy — hai thân yêu cầu giống nhau về nội dung nhưng khác thứ tự khoá cho cùng một chuỗi, để vân tay yêu cầu
 * ổn định. `undefined` trong đối tượng bị bỏ như JSON.stringify chuẩn; giá trị không tuần tự hoá được (BigInt, vòng tham chiếu) làm hàm ném lỗi — nơi gọi quyết định.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value)) ?? 'null';
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortKeysDeep(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}
