/**
 * "Đa thu ngân" (2026-09-04) — `billing` (`InvoiceService.markPaid()`/`.refund()`) đọc qua port
 * này thay vì import thẳng module `cashier-shift`. Lý do khác các port đọc `ClinicConfigReaderPort`
 * khác: `cashier-shift` đã `imports: [BillingModule]` sẵn (dùng `PaymentRepository` để tính tổng
 * kết ca) — nếu `billing` import ngược lại `CashierShiftModule` bình thường sẽ tạo vòng lặp module
 * (`BillingModule` ⇄ `CashierShiftModule`), phải bọc `forwardRef()` ở CẢ HAI `@Module()` (xem
 * `billing.module.ts`/`cashier-shift.module.ts`) — vòng phụ thuộc 2 chiều có thật (mỗi module cần
 * dữ liệu của module kia), không phải lỗi thiết kế.
 */
export interface CashierShiftReaderPort {
  /**
   * Id ca thu ngân LIÊN QUAN tới `actorId` TẠI THỜI ĐIỂM gọi — TẮT "Đa thu ngân" (mặc định): ca
   * đang mở CHUNG của cả tenant nếu có; BẬT: ca đang mở CỦA CHÍNH `actorId` nếu có. `null` khi
   * không có ca nào đang mở — KHÔNG chặn tạo `payment` (độc lập với công tắc "Yêu cầu mở ca trước
   * khi thu tiền"), chỉ đơn thuần không gắn `cashierShiftId`.
   */
  getRelevantOpenShiftId(tenantId: string, actorId: string): Promise<string | null>;
}

export const CASHIER_SHIFT_READER_PORT = Symbol('CASHIER_SHIFT_READER_PORT');
