/**
 * Huỷ lượt khám + hoàn tiền (docs/DECISIONS.md #085) — quy tắc vòng đời phiếu thu khi lượt khám
 * KHÔNG đi tới `COMPLETED`. Hàm THUẦN (không phụ thuộc Prisma/NestJS), là nguồn sự thật duy nhất
 * cho cả `EncounterService.cancelEncounter()` lẫn `InvoiceService.refund()` — cùng phong cách bảng
 * tra cứu thuần như `encounter/encounter-state-machine.ts`.
 *
 *   UNPAID ──thu tiền──> PAID ──hoàn tiền──> REFUNDED
 *      └──huỷ lượt khám──> CANCELLED
 *
 * Ba khái niệm dễ bị gộp nhầm, tách bạch tại đây:
 *   - "Đánh dấu chưa thu" (`InvoiceService.revertPayment`) = SỬA THAO TÁC BẤM NHẦM. Soft-delete
 *     dòng payment, phiếu quay lại UNPAID như chưa từng thu. KHÔNG liên quan file này.
 *   - "Huỷ lượt khám"  = khách bỏ về. Phiếu chưa thu thì đóng luôn (CANCELLED); phiếu đã thu thì
 *     GIỮ NGUYÊN PAID chờ hoàn tiền (xem `resolveInvoiceStatusOnEncounterCancel`).
 *   - "Hoàn tiền"      = trả tiền thật ra khỏi két, tạo dòng payment REFUND đối ứng.
 */

/** Khớp `invoiceStatusSchema` (`@nexamed/shared`) — lặp lại ở đây để `packages/core` không phụ thuộc ngược. */
export type InvoiceLifecycleStatus = 'UNPAID' | 'PAID' | 'CANCELLED' | 'REFUNDED';

/**
 * Trạng thái đích của phiếu thu khi lượt khám bị huỷ. Trả `null` = KHÔNG đổi gì.
 *
 * `PAID` cố ý giữ nguyên (không tự nhảy `REFUNDED`): hoàn tiền là thao tác riêng cần quyền
 * `invoice.refund`, trong khi huỷ lượt khám chỉ cần `encounter.cancel` (lễ tân có). Nếu ép hoàn
 * tiền cùng lúc thì lễ tân sẽ KHÔNG huỷ nổi ca của khách đã đóng tiền khi admin vắng mặt — tình
 * huống rất thật ở phòng khám nhỏ. Phiếu `PAID` của ca đã huỷ hiện cảnh báo "Cần hoàn tiền" ở
 * màn Thu ngân để người có quyền xử lý sau.
 */
export function resolveInvoiceStatusOnEncounterCancel(current: InvoiceLifecycleStatus): InvoiceLifecycleStatus | null {
  return current === 'UNPAID' ? 'CANCELLED' : null;
}

/** Phiếu thu đã đóng sổ — không thu tiền, không lưu tạm, không hoàn thêm lần nữa. */
export function isInvoiceClosed(status: InvoiceLifecycleStatus): boolean {
  return status === 'CANCELLED' || status === 'REFUNDED';
}

/**
 * Hoàn tiền được hay chưa. Đòi ĐỒNG THỜI 2 điều kiện — cố ý chặt, tránh hoàn nhầm cho ca vẫn đang
 * khám bình thường: phiếu còn `PAID` (chưa hoàn lần nào) VÀ lượt khám đã thực sự bị huỷ.
 */
export function canRefundInvoice(params: { invoiceStatus: InvoiceLifecycleStatus; encounterCancelled: boolean }): boolean {
  return params.invoiceStatus === 'PAID' && params.encounterCancelled;
}

/**
 * Phiếu `PAID` của lượt khám đã huỷ = còn nợ khách một khoản hoàn tiền. Dùng để hiện cảnh báo
 * "Cần hoàn tiền" ở danh sách/chi tiết Thu ngân (không phải trạng thái lưu trong DB — suy ra từ
 * cặp trạng thái, đúng tinh thần không thêm cột dẫn xuất).
 */
export function needsRefund(params: { invoiceStatus: InvoiceLifecycleStatus; encounterCancelled: boolean }): boolean {
  return canRefundInvoice(params);
}

export interface DailyBillingTotalsInput {
  status: InvoiceLifecycleStatus;
  totalAmount: number;
}

export interface DailyBillingTotals {
  paidCount: number;
  /** Tiền đã thu vào trong ngày — gồm cả phiếu sau đó bị hoàn (đúng chiều tiền thực tế đã vào két). */
  paidTotalAmount: number;
  unpaidCount: number;
  unpaidTotalAmount: number;
  refundedCount: number;
  refundedTotalAmount: number;
  /** `paidTotalAmount - refundedTotalAmount` — số khớp với tiền còn lại trong két cuối ngày. */
  netTotalAmount: number;
}

/**
 * Tổng kết thu cuối ngày (BIL-04), mở rộng ở #085 từ 2 số (đã thu/chờ thu) lên 3 nhóm + thực thu.
 *
 * Quy ước quan trọng: phiếu `REFUNDED` VẪN tính vào `paidTotalAmount` (tiền đã thật sự vào két
 * trong ngày) rồi trừ ra ở `netTotalAmount` — không im lặng xoá khỏi cột "Đã thu", vì như vậy chủ
 * phòng khám đối soát két sẽ không giải thích được khoản chênh. Phiếu `CANCELLED` (huỷ khi chưa
 * thu) không tính vào bất kỳ cột tiền nào — chưa có đồng nào đổi chủ.
 */
export function computeDailyBillingTotals(invoices: readonly DailyBillingTotalsInput[]): DailyBillingTotals {
  const totals: DailyBillingTotals = {
    paidCount: 0,
    paidTotalAmount: 0,
    unpaidCount: 0,
    unpaidTotalAmount: 0,
    refundedCount: 0,
    refundedTotalAmount: 0,
    netTotalAmount: 0,
  };

  for (const invoice of invoices) {
    switch (invoice.status) {
      case 'PAID':
        totals.paidCount += 1;
        totals.paidTotalAmount += invoice.totalAmount;
        break;
      case 'REFUNDED':
        totals.paidCount += 1;
        totals.paidTotalAmount += invoice.totalAmount;
        totals.refundedCount += 1;
        totals.refundedTotalAmount += invoice.totalAmount;
        break;
      case 'UNPAID':
        totals.unpaidCount += 1;
        totals.unpaidTotalAmount += invoice.totalAmount;
        break;
      case 'CANCELLED':
        break;
    }
  }

  totals.netTotalAmount = totals.paidTotalAmount - totals.refundedTotalAmount;
  return totals;
}