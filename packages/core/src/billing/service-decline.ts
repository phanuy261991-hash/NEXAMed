/**
 * "Khách không làm dịch vụ" (docs/DECISIONS.md #280) — các hàm THUẦN quyết định dòng nào bỏ được và
 * bỏ thì tiền đổi bao nhiêu. Không phụ thuộc Prisma/NestJS; `packages/core` không import
 * `@nexamed/shared` nên các kiểu dùng ở đây khai lại cục bộ, đúng tiền lệ `invoice-lifecycle.ts`.
 *
 * Cột tiền là bigint đồng (CLAUDE.md) nên mọi phép cộng/trừ chạy bằng BigInt rồi mới đổi về number —
 * tổng tiền một phiếu nhiều dòng có thể vượt 2^53 với đơn giá lớn.
 */

/** Trạng thái dòng chỉ định — bản sao cục bộ của `clinicalOrderItemStatusSchema` ở `@nexamed/shared`. */
export type DeclineOrderItemStatus = 'ORDERED' | 'CANCELLED' | 'IN_PROGRESS' | 'RESULTED' | 'COMPLETED';

/** Chế độ xử lý khi bỏ một dịch vụ trong gói — bản sao cục bộ của `packageDeclineModeSchema`. */
export type DeclinePackageMode = 'BLOCK' | 'REPRICE_SINGLE' | 'KEEP_PACKAGE_PRICE';

/** Mã lý do KHÔNG bỏ được — bản sao cục bộ của `SERVICE_DECLINE_BLOCKED_REASONS`. */
export type DeclineBlockedReason =
  | 'WORK_STARTED'
  | 'ALREADY_CANCELLED'
  | 'ALREADY_REFUNDED'
  | 'PACKAGE_ITEM_BLOCKED'
  | 'PACKAGE_REPRICE_PAID'
  | 'NOT_BILLED_HERE';

export interface DeclinableOrderItem {
  orderItemId: string;
  status: DeclineOrderItemStatus;
  /** `null` = dịch vụ lẻ; có giá trị = thuộc một gói dịch vụ. */
  packageId: string | null;
  /** `null` = chỉ định ra ngoài (không có dòng hoá đơn nào ở phòng khám). */
  invoiceLineId: string | null;
  /** Tiền THẬT của dòng sau chiết khấu (net). `0` khi dòng không tính tiền. */
  lineNet: number;
  /** Tổng đã hoàn của dòng này (cộng dồn nhiều lần hoàn). */
  refundedAmount: number;
}

export type DeclineVerdict = { declinable: true } | { declinable: false; reason: DeclineBlockedReason };

/**
 * Dòng này có bỏ được ở quầy hay không. Thứ tự kiểm là CỐ Ý và xác định — lý do trả về luôn là lý do
 * ĐẦU TIÊN khớp, để câu báo cho thu ngân không đổi theo thứ tự dữ liệu:
 *
 *  1. đã huỷ trước đó — không huỷ hai lần;
 *  2. không còn `ORDERED` (đã lấy mẫu/gọi vào phòng/có kết quả) — việc đã làm thì vẫn phải trả tiền;
 *  3. không có dòng hoá đơn (chỉ định ra ngoài) — quầy không có gì để gỡ hay hoàn, bác sĩ tự gỡ ở màn khám;
 *  4. đã hoàn hết phần tiền của dòng;
 *  5. thuộc gói mà phòng khám đang chặn bỏ lẻ;
 *  6. thuộc gói, chế độ "tính lại theo giá lẻ", mà phiếu ĐÃ THU.
 */
export function evaluateDeclinableItem(item: DeclinableOrderItem, packageMode: DeclinePackageMode, invoicePaid = false): DeclineVerdict {
  if (item.status === 'CANCELLED') return { declinable: false, reason: 'ALREADY_CANCELLED' };
  if (item.status !== 'ORDERED') return { declinable: false, reason: 'WORK_STARTED' };
  if (item.invoiceLineId === null) return { declinable: false, reason: 'NOT_BILLED_HERE' };
  if (item.lineNet > 0 && item.refundedAmount >= item.lineNet) return { declinable: false, reason: 'ALREADY_REFUNDED' };
  if (item.packageId !== null && packageMode === 'BLOCK') return { declinable: false, reason: 'PACKAGE_ITEM_BLOCKED' };
  // Tính lại theo giá lẻ có thể đòi khách trả THÊM; phiếu đã thu không còn chỗ để thu nên không làm được.
  if (item.packageId !== null && packageMode === 'REPRICE_SINGLE' && invoicePaid) return { declinable: false, reason: 'PACKAGE_REPRICE_PAID' };
  return { declinable: true };
}

/** Lọc ra đúng các dòng bỏ được, kèm verdict của từng dòng để giao diện giải thích dòng bị khoá. */
export function evaluateDeclinableItems(
  items: readonly DeclinableOrderItem[],
  packageMode: DeclinePackageMode,
  invoicePaid = false,
): { item: DeclinableOrderItem; verdict: DeclineVerdict }[] {
  return items.map((item) => ({ item, verdict: evaluateDeclinableItem(item, packageMode, invoicePaid) }));
}

/**
 * Phần tiền còn lại của một dòng — cơ sở để trừ khỏi phiếu (chưa thu) hoặc hoàn (đã thu).
 * Đã hoàn một phần thì chỉ còn phần chưa hoàn; không bao giờ trả số âm.
 */
export function remainingLineAmount(item: Pick<DeclinableOrderItem, 'lineNet' | 'refundedAmount'>): number {
  const remaining = BigInt(item.lineNet) - BigInt(item.refundedAmount);
  return remaining > 0n ? Number(remaining) : 0;
}

/**
 * Tổng tiền thay đổi khi bỏ một nhóm dịch vụ LẺ (hoặc dịch vụ trong gói ở chế độ `REPRICE_SINGLE` —
 * phần tính lại giá gói đi qua `computePackageRepriceDelta` riêng).
 *
 * Chế độ `KEEP_PACKAGE_PRICE` KHÔNG dùng hàm này: tiền không đổi nên gọi bên ngoài truyền mảng rỗng.
 */
export function computeDeclineAmount(items: readonly Pick<DeclinableOrderItem, 'lineNet' | 'refundedAmount'>[]): number {
  let total = 0n;
  for (const item of items) total += BigInt(remainingLineAmount(item));
  return Number(total);
}

export interface PackageRepriceInput {
  /** Tiền thật của DÒNG HOÁ ĐƠN gói (một dòng cho cả gói), sau chiết khấu. */
  packageLineNet: number;
  /** Giá lẻ gốc của các dịch vụ con CÒN LẠI sau khi bỏ (mảng rỗng = bỏ hết gói). */
  keptListPrices: readonly number[];
}

export interface PackageRepriceResult {
  /** Tổng tiền của phần còn lại khi tính theo giá lẻ. */
  repricedTotal: number;
  /** Tiền GIẢM khỏi phiếu, luôn ≥ 0. */
  decrease: number;
  /** Tiền khách phải trả THÊM, luôn ≥ 0 — xảy ra khi mất chiết khấu gói. */
  surcharge: number;
}

/**
 * Gói tan thành dịch vụ lẻ (`REPRICE_SINGLE`): bỏ dòng gói, tính lại phần còn lại theo GIÁ LẺ GỐC.
 *
 * Kết quả có thể là khách phải trả **THÊM** — gói thường rẻ hơn tổng giá lẻ, nên bỏ một mục xong
 * tính lại từng cái có thể đắt hơn cả gói ban đầu. Trả riêng `decrease`/`surcharge` (không dùng số
 * âm) để tầng gọi hiện đúng câu cho thu ngân TRƯỚC khi xác nhận, không để họ đoán.
 */
export function computePackageRepriceDelta(input: PackageRepriceInput): PackageRepriceResult {
  let kept = 0n;
  for (const price of input.keptListPrices) kept += BigInt(price);
  const delta = kept - BigInt(input.packageLineNet);
  return {
    repricedTotal: Number(kept),
    decrease: delta < 0n ? Number(-delta) : 0,
    surcharge: delta > 0n ? Number(delta) : 0,
  };
}
