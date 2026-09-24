/**
 * "Công nợ nhà cung cấp" (docs/DECISIONS.md #180/#182, kế hoạch kỹ thuật
 * C:\Users\Administrator\.claude\plans\supplier-debt-cong-no-ncc.md mục 3.1) — phân bổ NGẦM theo
 * FIFO: người dùng KHÔNG chọn phiếu lúc trả, hệ thống tự tính phiếu nào đã trả đủ/trả một phần,
 * nhưng vẫn truy vết được (mỗi khoản trả biết đã "chảy" vào khoản nợ nào). Tính LÚC ĐỌC từ sổ
 * `SupplierDebtEntry` (không lưu bảng phân bổ riêng) — dữ liệu 1 NCC nhỏ, tránh phải đồng bộ lại
 * mỗi khi có bút toán ĐẢO (huỷ chứng từ).
 *
 * Thuật toán (đầu vào PHẢI đã sắp đúng thứ tự ghi sổ — `createdAt ASC, id ASC`):
 * 1. Loại cặp (bút toán gốc + REVERSAL của nó) khỏi tính toán — cả hai coi như chưa từng xảy ra.
 * 2. Mỗi bút toán TĂNG nợ (amountChange > 0 — PURCHASE/OPENING_BALANCE/ADJUSTMENT_INCREASE/
 *    REFUND_RECEIVED) là 1 "khoản nợ" mới. Trước khi trở thành khoản nợ, nó bị offset bởi phần
 *    "NCC nợ lại" (`overpaidCarry`) tồn đọng từ trước — đúng ý "tự cấn trừ vào khoản nợ phát sinh
 *    SAU" (mục 3.1 kế hoạch).
 * 3. Mỗi bút toán GIẢM nợ (amountChange < 0 — PAYMENT/RETURN/ADJUSTMENT_DECREASE) trừ vào ĐÚNG
 *    khoản đích trước (nếu có `stockReceiptId` chỉ định VÀ khoản đó còn dư), phần còn lại + mọi
 *    khoản KHÔNG có đích trừ FIFO vào khoản nợ CŨ NHẤT còn dư. Trả dư hết mọi khoản hiện có →
 *    cộng dồn vào `overpaidCarry` (NCC đang nợ lại phòng khám).
 *
 * Nhóm theo `key` = `stockReceiptId` nếu có (PURCHASE — mỗi phiếu nhập 1 dòng kết quả), ngược lại
 * theo `entry.id` riêng (OPENING_BALANCE/ADJUSTMENT_INCREASE/REFUND_RECEIVED không gắn 1 phiếu nhập
 * cụ thể nào — mỗi bút toán là 1 dòng kết quả riêng).
 */

export type SupplierDebtEntryType =
  | 'OPENING_BALANCE'
  | 'PURCHASE'
  | 'PAYMENT'
  | 'RETURN'
  | 'REFUND_RECEIVED'
  | 'ADJUSTMENT_INCREASE'
  | 'ADJUSTMENT_DECREASE'
  | 'REVERSAL';

export interface SupplierDebtEntryInput {
  id: string;
  entryType: SupplierDebtEntryType;
  /** Có dấu — đồng, dương = tăng nợ, âm = giảm nợ. */
  amountChange: number;
  /** Nguồn (PURCHASE) hoặc đích chỉ định của khoản trả (PAYMENT trả ngay/RETURN có chọn phiếu
   * gốc/ADJUSTMENT gắn phiếu) — `null` nếu không gắn 1 phiếu nhập cụ thể. */
  stockReceiptId: string | null;
  /** `id` của bút toán bị đảo — chỉ có ở `entryType==='REVERSAL'`. */
  reversalOfId: string | null;
}

export type SupplierDebtItemStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'FULLY_PAID';

export interface SupplierDebtItemAllocation {
  /** `stockReceiptId` nếu khoản nợ gắn 1 phiếu nhập, ngược lại `id` của chính bút toán tạo ra nó. */
  key: string;
  /** `id` của bút toán TĂNG nợ gốc (PURCHASE/OPENING_BALANCE/ADJUSTMENT_INCREASE/REFUND_RECEIVED). */
  entryId: string;
  entryType: SupplierDebtEntryType;
  stockReceiptId: string | null;
  /** Số tiền nợ GỐC của khoản này (chưa trừ gì). */
  originalAmount: number;
  /** Đã trả/cấn trừ (gồm cả phần bị `overpaidCarry` offset ngay từ đầu, nếu có). */
  paidAmount: number;
  /** Còn nợ = originalAmount - paidAmount. */
  dueAmount: number;
  status: SupplierDebtItemStatus;
}

export interface AllocateSupplierDebtResult {
  items: SupplierDebtItemAllocation[];
  /** Phần trả dư không còn khoản nợ nào để trừ, CHƯA được khoản nợ phát sinh sau nào cấn trừ hết —
   * tương ứng "NCC đang nợ lại phòng khám" phần chưa có gì để offset (thường = 0 nếu đã có khoản
   * nợ mới phát sinh sau khoản trả dư đó; > 0 khi khoản trả dư là bút toán MỚI NHẤT). */
  overpaidCarry: number;
}

interface MutableItem extends SupplierDebtItemAllocation {
  remaining: number;
}

function statusOf(original: number, remaining: number): SupplierDebtItemStatus {
  if (remaining <= 0) return 'FULLY_PAID';
  if (remaining >= original) return 'UNPAID';
  return 'PARTIALLY_PAID';
}

export function allocateSupplierDebt(entries: readonly SupplierDebtEntryInput[]): AllocateSupplierDebtResult {
  const reversedIds = new Set(entries.filter((e) => e.entryType === 'REVERSAL' && e.reversalOfId).map((e) => e.reversalOfId!));
  const active = entries.filter((e) => e.entryType !== 'REVERSAL' && !reversedIds.has(e.id));

  const items: MutableItem[] = [];
  let overpaidCarry = 0;

  for (const entry of active) {
    if (entry.amountChange > 0) {
      let amount = entry.amountChange;
      if (overpaidCarry > 0) {
        const offset = Math.min(overpaidCarry, amount);
        overpaidCarry -= offset;
        amount -= offset;
      }
      const key = entry.stockReceiptId ?? entry.id;
      items.push({
        key,
        entryId: entry.id,
        entryType: entry.entryType,
        stockReceiptId: entry.stockReceiptId,
        originalAmount: entry.amountChange,
        paidAmount: entry.amountChange - amount,
        dueAmount: amount,
        remaining: amount,
        status: statusOf(entry.amountChange, amount),
      });
    } else if (entry.amountChange < 0) {
      let toAllocate = -entry.amountChange;

      if (entry.stockReceiptId) {
        const target = items.find((it) => it.key === entry.stockReceiptId && it.remaining > 0);
        if (target) {
          const applied = Math.min(target.remaining, toAllocate);
          target.remaining -= applied;
          toAllocate -= applied;
        }
      }

      for (const item of items) {
        if (toAllocate <= 0) break;
        if (item.remaining <= 0) continue;
        const applied = Math.min(item.remaining, toAllocate);
        item.remaining -= applied;
        toAllocate -= applied;
      }

      if (toAllocate > 0) overpaidCarry += toAllocate;
    }
    // amountChange === 0 không xảy ra (CHECK DB `amount_change <> 0`) — bỏ qua phòng thủ.
  }

  const finalized: SupplierDebtItemAllocation[] = items.map((it) => ({
    key: it.key,
    entryId: it.entryId,
    entryType: it.entryType,
    stockReceiptId: it.stockReceiptId,
    originalAmount: it.originalAmount,
    paidAmount: it.originalAmount - it.remaining,
    dueAmount: it.remaining,
    status: statusOf(it.originalAmount, it.remaining),
  }));

  return { items: finalized, overpaidCarry };
}
