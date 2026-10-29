/**
 * Số lượng dưới 10 viết hai chữ số ("05", "01") như toa mẫu; từ 10 trở lên giữ nguyên (docs/DECISIONS.md #267).
 * Dùng cho cột SL của bản in đơn thuốc (ô tích "In số lượng dưới 10 bằng hai chữ số") và nhãn dán bì thuốc.
 */
export function padSmallQuantity(quantity: number): string {
  return quantity >= 0 && quantity < 10 ? `0${quantity}` : String(quantity);
}
