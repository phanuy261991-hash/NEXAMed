/**
 * Cận lâm sàng GĐ2 (docs/DECISIONS.md #212) — giá bán thuốc/vật tư sau khi áp "Bảng giá có thời hạn". Kho thuốc
 * (`InventoryModule`, Phiếu xuất kho #164) KHÔNG import thẳng module `pricing` — cùng ranh giới và cùng lý do với
 * `StockAvailabilityPort` (#165): chỉ inject token, adapter thật đăng ký ở `PricingPortModule` (`@Global()`).
 */
export interface PricingPort {
  /**
   * Giá bán theo ĐƠN VỊ CƠ SỞ của từng thuốc/vật tư tại `date` (yyyy-mm-dd, giờ Việt Nam — ngày LẬP PHIẾU xuất), đã áp
   * bảng giá ưu tiên cao nhất đang hiệu lực. `null` = thuốc chưa có giá bán; thuốc không tồn tại không có trong kết quả.
   * Không có bảng giá nào → đúng bằng `drug.default_sell_price` (hành vi cũ, pilot không đổi gì khi chưa tạo bảng giá).
   */
  getDrugBaseUnitPrices(tenantId: string, date: string, drugIds: string[]): Promise<Record<string, number | null>>;
}

export const PRICING_PORT = Symbol('PRICING_PORT');
