/**
 * Chiết khấu trên phiếu thu (Chi tiết thanh toán) — chốt qua `AskUserQuestion` trước khi code: 1
 * phiếu chỉ dùng MỘT trong hai cách tại một thời điểm — "Toàn hoá đơn" (áp %/tiền lên
 * `invoice.totalAmount`) HOẶC "Từng dịch vụ" (áp %/tiền lên từng `InvoiceLine.lineTotal`, cộng lại)
 * — không cộng dồn cả hai. Hàm THUẦN, không phụ thuộc Prisma/NestJS, là nguồn sự thật duy nhất cho
 * `InvoiceService` (backend) tính `dueAmount` (số tiền THẬT phải thu/đã thu, khác `totalAmount` là
 * tổng gộp trước chiết khấu) — dùng ở `markPaid()`, `payWithWalletCore()`,
 * `computeDailyBillingTotals()` (tổng kết cuối ngày phải dùng `dueAmount`, không phải
 * `totalAmount`, nếu không sẽ sai ngay khi có phiếu chiết khấu đầu tiên).
 *
 * Không lưu `discountAmount`/`dueAmount` thành cột riêng trong DB — tính lại từ
 * `discountType`/`discountValue` (2 cấp) mỗi lần đọc, đúng tinh thần "không lưu derived field"
 * (như `needsRefund()` ở `invoice-lifecycle.ts`).
 */

export type DiscountType = 'PERCENT' | 'AMOUNT';
export type InvoiceDiscountMode = 'NONE' | 'TOTAL' | 'PER_LINE';

export interface LineDiscountInput {
  lineTotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
}

/**
 * Số tiền chiết khấu (đồng) của MỘT dòng/hoá đơn dựa trên `base` (lineTotal hoặc totalAmount).
 * PERCENT: `base * value / 100`, làm tròn round-half-up (CLAUDE.md: chỉ làm tròn ở bước cuối —
 * `Math.round()` cho số không âm chính là round-half-up). AMOUNT: giá trị nhập thẳng, clamp về
 * `[0, base]` — không cho chiết khấu vượt quá giá trị gốc (tránh `dueAmount` âm).
 */
export function computeDiscountAmount(base: number, discountType: DiscountType | null, discountValue: number | null): number {
  if (discountType === null || discountValue === null || discountValue <= 0) {
    return 0;
  }
  const raw = discountType === 'PERCENT' ? Math.round((base * discountValue) / 100) : discountValue;
  return Math.min(Math.max(raw, 0), base);
}

export interface InvoiceDiscountResult {
  mode: InvoiceDiscountMode;
  /** Tổng tiền chiết khấu (đồng) — 0 khi `mode==='NONE'`. */
  discountAmount: number;
  /** `totalAmount - discountAmount` — số tiền THẬT phải thu/đã thu, dùng ở mọi nơi tính tiền. */
  dueAmount: number;
}

/**
 * Nguồn tính duy nhất cho `dueAmount` của một phiếu thu. Bất kỳ dòng nào trong `lines` có
 * `discountType != null` ⇒ chế độ PER_LINE (tổng chiết khấu = tổng từng dòng, BỎ QUA
 * `discountType`/`discountValue` cấp hoá đơn — 2 cấp loại trừ lẫn nhau, `InvoiceRepository.
 * applyDiscount()` đã ghi đè null phía không dùng nên trong thực tế không bao giờ cả hai cùng có
 * dữ liệu, nhưng hàm vẫn phải xác định rõ hành vi trong trường hợp đó thay vì mơ hồ).
 */
export function computeInvoiceDiscount(params: {
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  lines: readonly LineDiscountInput[];
}): InvoiceDiscountResult {
  const { totalAmount, discountType, discountValue, lines } = params;

  const hasLineDiscount = lines.some((l) => l.discountType !== null);
  if (hasLineDiscount) {
    const discountAmount = lines.reduce((sum, l) => sum + computeDiscountAmount(l.lineTotal, l.discountType, l.discountValue), 0);
    return { mode: 'PER_LINE', discountAmount, dueAmount: totalAmount - discountAmount };
  }

  if (discountType !== null) {
    const discountAmount = computeDiscountAmount(totalAmount, discountType, discountValue);
    return { mode: 'TOTAL', discountAmount, dueAmount: totalAmount - discountAmount };
  }

  return { mode: 'NONE', discountAmount: 0, dueAmount: totalAmount };
}
