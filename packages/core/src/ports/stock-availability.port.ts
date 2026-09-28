/**
 * Kho Thuốc GĐ5 — đọc TỔNG tồn kho (cộng dồn mọi kho) theo từng thuốc, phục vụ cảnh báo/chặn "kê
 * vượt tồn" lúc ký đơn (`EncounterService.signPrescription()`). `encounter` KHÔNG import thẳng
 * `InventoryModule` để lấy `StockBalanceRepository` — chiều phụ thuộc `EncounterModule ↛
 * InventoryModule` đã CHỐT tường minh (xem comment trong `encounter.module.ts`, gỡ bỏ cùng lúc bỏ
 * "Tự động phát thuốc lúc ký đơn", #165) — dùng port này thay vì `ClinicConfigReaderPort` (mẫu
 * "import module sở hữu để lấy provide token") vì mẫu đó SẼ đòi `EncounterModule` import
 * `InventoryModule`, đúng thứ bị cấm. Adapter thật đăng ký ở một module `@Global()` riêng
 * (`apps/api/src/modules/inventory/stock-availability.module.ts`) tự import `InventoryModule` để
 * đọc `StockBalanceRepository` — `EncounterModule` chỉ inject token, không thêm gì vào `imports`.
 */
export interface StockAvailabilityPort {
  /** `Record<drugId, tổng quantityOnHand mọi kho>` — thuốc không có dòng `stock_balance` nào coi như `0`. */
  getOnHandQuantities(tenantId: string, drugIds: string[]): Promise<Record<string, number>>;
}

export const STOCK_AVAILABILITY_PORT = Symbol('STOCK_AVAILABILITY_PORT');
