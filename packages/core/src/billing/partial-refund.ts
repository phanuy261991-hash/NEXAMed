import { computeDiscountAmount, computeInvoiceDiscount, type DiscountType } from './invoice-discount';

/**
 * Hoàn tiền MỘT PHẦN theo từng dòng thuốc (docs/DECISIONS.md #203) — các hàm THUẦN tính tiền, không
 * phụ thuộc Prisma/NestJS. Cột tiền là bigint đồng, CLAUDE.md: round-half-up, CHỈ làm tròn ở bước
 * cuối — nên các phép nhân/chia dưới đây chạy bằng BigInt (tích `tiền × số lượng` có thể vượt 2^53
 * với đơn lớn) rồi mới đổi về number.
 */

export interface RefundableLineInput {
  /** Thành tiền gross của dòng (trước chiết khấu). */
  lineTotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
}

/**
 * Chia số tiền THẬT (`dueAmount` sau chiết khấu) xuống từng dòng — "net" của dòng, làm cơ sở tính
 * tiền hoàn. Tổng net luôn KHỚP `dueAmount` từng đồng:
 *  - `PER_LINE`: net = lineTotal − chiết khấu của chính dòng (đã là số xác định).
 *  - `TOTAL`/`NONE`: chiết khấu cấp hoá đơn không gắn dòng nào, chia `dueAmount` theo tỷ lệ
 *    `lineTotal` bằng phương pháp phần dư lớn nhất (largest remainder), hoà thì dòng đứng trước được
 *    ưu tiên — kết quả xác định, không phụ thuộc thứ tự thực thi.
 */
export function allocateInvoiceDueToLines(params: {
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  lines: readonly RefundableLineInput[];
}): number[] {
  const { totalAmount, discountType, discountValue, lines } = params;
  const { mode, dueAmount } = computeInvoiceDiscount({ totalAmount, discountType, discountValue, lines });

  if (mode === 'PER_LINE') {
    return lines.map((l) => l.lineTotal - computeDiscountAmount(l.lineTotal, l.discountType, l.discountValue));
  }

  const sumLineTotal = lines.reduce((sum, l) => sum + BigInt(l.lineTotal), 0n);
  if (sumLineTotal === 0n) {
    return lines.map(() => 0);
  }

  const due = BigInt(dueAmount);
  const shares = lines.map((l, index) => {
    const numerator = due * BigInt(l.lineTotal);
    return { index, floor: numerator / sumLineTotal, remainder: numerator % sumLineTotal };
  });
  let leftover = due - shares.reduce((sum, s) => sum + s.floor, 0n);
  const byRemainder = [...shares].sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  const result = shares.map((s) => s.floor);
  for (const s of byRemainder) {
    if (leftover <= 0n) break;
    result[s.index] = (result[s.index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return result.map((n) => Number(n));
}

/** round-half-up của `net × k / total` bằng số nguyên (không dùng số thực). */
function roundedShare(net: bigint, k: bigint, total: bigint): bigint {
  return (2n * net * k + total) / (2n * total);
}

/**
 * Tiền hoàn cho lần trả `refundQty` của một dòng đã bán `lineQty`, trước đó đã trả `alreadyRefundedQty`.
 * Tính theo SỐ LƯỢNG CỘNG DỒN: `round(net × (đã+này)/Q) − round(net × đã/Q)` — nhờ vậy dù chia thành
 * bao nhiêu lần, tổng hoàn khi đã trả hết `lineQty` đúng bằng `lineNet`, không lệch 1 đồng do làm tròn
 * từng lần.
 */
export function computeLineRefundAmount(lineNet: number, lineQty: number, alreadyRefundedQty: number, refundQty: number): number {
  if (!Number.isInteger(lineQty) || lineQty <= 0) throw new RangeError('lineQty phải là số nguyên dương');
  if (!Number.isInteger(refundQty) || refundQty <= 0) throw new RangeError('refundQty phải là số nguyên dương');
  if (!Number.isInteger(alreadyRefundedQty) || alreadyRefundedQty < 0) throw new RangeError('alreadyRefundedQty không hợp lệ');
  if (alreadyRefundedQty + refundQty > lineQty) throw new RangeError('Số lượng hoàn vượt quá số đã bán');

  const net = BigInt(lineNet);
  const total = BigInt(lineQty);
  const after = roundedShare(net, BigInt(alreadyRefundedQty + refundQty), total);
  const before = roundedShare(net, BigInt(alreadyRefundedQty), total);
  return Number(after - before);
}

export interface PaymentMethodRemaining {
  method: string;
  /** Số tiền còn hoàn được của phương thức này = đã thu − đã hoàn. */
  remaining: number;
}

export interface RefundAllocation {
  method: string;
  amount: number;
}

/**
 * Chia số tiền hoàn về các phương thức khách đã thanh toán (chốt qua AskUserQuestion, #203): VÍ TẠM
 * ỨNG trước (tiền trả ngược vào ví, không rời phòng khám — khớp #136), phần dư mới ra các phương
 * thức còn lại theo đúng thứ tự đã thu. Không phương thức nào bị hoàn quá số đã thu; nếu tổng
 * `remaining` không đủ, phần thiếu trả về ở `shortfall` (người gọi coi là lỗi).
 */
export function allocateRefundAcrossPayments(amount: number, methods: readonly PaymentMethodRemaining[]): { allocations: RefundAllocation[]; shortfall: number } {
  const ordered = [...methods.filter((m) => m.method === 'WALLET'), ...methods.filter((m) => m.method !== 'WALLET')];
  const allocations: RefundAllocation[] = [];
  let left = amount;
  for (const m of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(m.remaining, 0));
    if (take > 0) {
      allocations.push({ method: m.method, amount: take });
      left -= take;
    }
  }
  return { allocations, shortfall: left };
}
