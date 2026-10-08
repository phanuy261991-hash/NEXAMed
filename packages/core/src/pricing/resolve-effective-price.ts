/**
 * Cận lâm sàng GĐ2 — "Bảng giá có thời hạn" (docs/DECISIONS.md #212). Logic THUẦN chọn giá áp dụng của một mặt hàng
 * vào một ngày: bảng giá có độ ưu tiên (số) cao nhất đang hiệu lực mà có chứa mặt hàng thắng; không bảng nào chứa thì
 * dùng giá mặc định (giá nhập trực tiếp trên mặt hàng = "Bảng giá chung", ưu tiên 0, không lưu bản sao).
 *
 * Hàm này KHÔNG biết DB, không biết ngày — nơi gọi (`PricingService`) đã lọc sẵn các bảng giá còn hiệu lực đúng ngày
 * áp giá (ngày tiếp nhận / ngày lập phiếu, chốt 06/10/2026) rồi mới truyền `lines` vào đây.
 */

export type PriceListLineMode = 'PERCENT_OFF' | 'NEW_PRICE';

/** Một dòng của một bảng giá ĐANG HIỆU LỰC (đã lọc theo ngày) — ứng viên để áp lên mặt hàng. */
export interface PriceListLineCandidate {
  priceListId: string;
  priceListName: string;
  /** Độ ưu tiên dạng số, CAO THẮNG. Bảng giá chung luôn là 0 và không bao giờ là ứng viên (xem `GENERAL_PRICE_LIST_PRIORITY`). */
  priority: number;
  /** Ngày bắt đầu hiệu lực (yyyy-mm-dd) — phá hoà khi 2 bảng cùng ưu tiên: bảng mới hơn thắng. */
  effectiveFrom: string;
  /** Thời điểm tạo (ms) — phá hoà lần 2 khi cùng ưu tiên và cùng ngày bắt đầu. */
  createdAtMs: number;
  mode: PriceListLineMode;
  /** PERCENT_OFF: số nguyên 1-100 (phần trăm giảm). NEW_PRICE: số tiền (đồng, bigint đổi sang number — an toàn tới 2^53). */
  value: number;
  /** null = áp cho MỌI Loại giá của dịch vụ (chỉ hợp lệ với PERCENT_OFF). */
  priceTypeCode: string | null;
  /** null = áp cho MỌI bậc đơn vị của thuốc/vật tư (chỉ hợp lệ với PERCENT_OFF). */
  unitCode: string | null;
}

/** Bảng giá chung (giá nhập trực tiếp trên mặt hàng) — luôn ưu tiên 0, mọi bảng có thời hạn đều từ 1 trở lên. */
export const GENERAL_PRICE_LIST_PRIORITY = 0;

/** Làm tròn nửa lên về 1 đồng (CLAUDE.md — chỉ làm tròn ở bước cuối). Dùng số nguyên để tránh sai số dấu phẩy động. */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError('denominator must be positive');
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  return r * 2 >= denominator ? q + 1 : q;
}

/** Giá sau khi áp một dòng bảng giá lên giá mặc định `baseAmount`. Không bao giờ âm. */
export function applyPriceListLine(baseAmount: number, line: Pick<PriceListLineCandidate, 'mode' | 'value'>): number {
  if (line.mode === 'NEW_PRICE') return Math.max(0, Math.trunc(line.value));
  const percent = Math.min(100, Math.max(0, line.value));
  return Math.max(0, roundHalfUpDiv(baseAmount * (100 - percent), 100));
}

export interface ResolveEffectivePriceInput {
  /** Giá mặc định (giá nhập trên mặt hàng) của đúng Loại giá/Đơn vị đang xét. `null` = mặt hàng chưa có giá. */
  baseAmount: number | null;
  /** Mọi dòng bảng giá đang hiệu lực chứa mặt hàng này (mọi Loại giá/Đơn vị). Thứ tự bất kỳ. */
  lines: readonly PriceListLineCandidate[];
  /** Loại giá dịch vụ đang xét — dòng có `priceTypeCode` khác bị bỏ; `null/undefined` = mặt hàng không có khái niệm Loại giá. */
  priceTypeCode?: string | null;
  /** Đơn vị đang xét — dòng có `unitCode` khác bị bỏ; `null/undefined` = mặt hàng không có khái niệm bậc đơn vị. */
  unitCode?: string | null;
}

export interface ResolvedEffectivePrice {
  /** Giá cuối cùng áp dụng. `null` khi mặt hàng không có giá mặc định VÀ không có dòng bảng giá nào áp được. */
  amount: number | null;
  baseAmount: number | null;
  /** Dòng bảng giá đã thắng; `null` = dùng giá mặc định (Bảng giá chung). */
  applied: PriceListLineCandidate | null;
}

function lineMatchesScope(line: PriceListLineCandidate, priceTypeCode: string | null, unitCode: string | null): boolean {
  if (line.priceTypeCode !== null && line.priceTypeCode !== priceTypeCode) return false;
  if (line.unitCode !== null && line.unitCode !== unitCode) return false;
  return true;
}

/** So sánh để chọn dòng thắng: ưu tiên cao hơn → ngày bắt đầu mới hơn → tạo sau hơn. Trả >0 nếu `a` thắng `b`. */
function compareCandidates(a: PriceListLineCandidate, b: PriceListLineCandidate): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom > b.effectiveFrom ? 1 : -1;
  return a.createdAtMs - b.createdAtMs;
}

/**
 * Chọn dòng bảng giá thắng trong số các dòng còn áp được cho (Loại giá, Đơn vị) đang xét. Dòng NEW_PRICE không có
 * giá mặc định vẫn áp được (mặt hàng chưa có giá nhập nhưng bảng giá đặt giá mới); dòng PERCENT_OFF thì cần `baseAmount`.
 */
export function selectPriceListLine(
  lines: readonly PriceListLineCandidate[],
  scope: { baseAmount: number | null; priceTypeCode?: string | null; unitCode?: string | null },
): PriceListLineCandidate | null {
  const priceTypeCode = scope.priceTypeCode ?? null;
  const unitCode = scope.unitCode ?? null;
  let best: PriceListLineCandidate | null = null;
  for (const line of lines) {
    if (!lineMatchesScope(line, priceTypeCode, unitCode)) continue;
    if (line.mode === 'PERCENT_OFF' && scope.baseAmount === null) continue;
    if (best === null || compareCandidates(line, best) > 0) best = line;
  }
  return best;
}

export function resolveEffectivePrice(input: ResolveEffectivePriceInput): ResolvedEffectivePrice {
  const winner = selectPriceListLine(input.lines, { baseAmount: input.baseAmount, priceTypeCode: input.priceTypeCode, unitCode: input.unitCode });
  if (winner === null) return { amount: input.baseAmount, baseAmount: input.baseAmount, applied: null };
  return { amount: applyPriceListLine(input.baseAmount ?? 0, winner), baseAmount: input.baseAmount, applied: winner };
}

/**
 * Giá bán theo đơn vị NHỎ NHẤT của thuốc/vật tư sau khi áp bảng giá. Kho phát thuốc luôn tính tiền theo đơn vị cơ sở
 * (`drug.default_sell_price`, #164) nên dòng "Giá mới" đặt cho bậc lớn (Hộp/Vỉ) được quy về giá 1 đơn vị cơ sở =
 * giá mới ÷ hệ số quy đổi (làm tròn nửa lên về 1 đồng); dòng "Giảm %" áp thẳng lên giá mặc định mọi bậc.
 *
 * `factorByUnitCode`: hệ số `factorToBaseUnit` của từng bậc (đơn vị cơ sở = 1) — lấy từ `computeUnitConversion`.
 * Dòng NEW_PRICE ở bậc không có trong bảng quy đổi bị bỏ qua (dữ liệu cũ sau khi đổi chuỗi đơn vị).
 */
export function resolveDrugBaseUnitPrice(input: {
  baseAmount: number | null;
  lines: readonly PriceListLineCandidate[];
  baseUnitCode: string;
  factorByUnitCode: ReadonlyMap<string, number>;
}): ResolvedEffectivePrice {
  const usable: PriceListLineCandidate[] = [];
  for (const line of input.lines) {
    if (line.mode === 'PERCENT_OFF') {
      if (input.baseAmount !== null) usable.push(line);
      continue;
    }
    const unit = line.unitCode ?? input.baseUnitCode;
    const factor = unit === input.baseUnitCode ? 1 : input.factorByUnitCode.get(unit);
    if (factor === undefined || factor <= 0) continue;
    usable.push(factor === 1 ? line : { ...line, value: roundHalfUpDiv(line.value, factor), unitCode: input.baseUnitCode });
  }
  // PERCENT_OFF mang `unitCode=null` (mọi bậc) nên khớp mọi `unitCode`; NEW_PRICE đã quy về đơn vị cơ sở ở trên.
  const winner = selectPriceListLine(usable, { baseAmount: input.baseAmount, unitCode: input.baseUnitCode });
  if (winner === null) return { amount: input.baseAmount, baseAmount: input.baseAmount, applied: null };
  return { amount: applyPriceListLine(input.baseAmount ?? 0, winner), baseAmount: input.baseAmount, applied: winner };
}

// ---------------------------------------------------------------------------------------------
// Gói dịch vụ
// ---------------------------------------------------------------------------------------------

export type ServicePackagePricingMode = 'FIXED' | 'SUM_MINUS_DISCOUNT';

export interface ServicePackageItemPrice {
  quantity: number;
  /** Giá lẻ 1 đơn vị của dịch vụ con (đã chọn theo quy tắc "giá lẻ" của nơi gọi); `null` = dịch vụ con chưa có giá. */
  unitPrice: number | null;
}

export interface ComputeServicePackagePriceInput {
  mode: ServicePackagePricingMode;
  /** Giá cố định — bắt buộc khi `mode='FIXED'`. */
  fixedPrice: number | null;
  discountType: 'PERCENT' | 'AMOUNT' | null;
  discountValue: number | null;
  items: readonly ServicePackageItemPrice[];
}

export interface ComputedServicePackagePrice {
  /** Giá gói áp dụng (trước khi áp bảng giá có thời hạn). `null` = chưa tính được (FIXED thiếu giá). */
  price: number | null;
  /** Tổng giá lẻ các dịch vụ con có giá. */
  retailTotal: number;
  /** Số dịch vụ con chưa có giá lẻ — nếu >0 thì `retailTotal` chưa đủ, UI nên cảnh báo. */
  unpricedItemCount: number;
  /** Khách lợi so với mua lẻ (`retailTotal - price`, có thể âm nếu gói đắt hơn lẻ) — `null` khi `price` null. */
  saving: number | null;
}

/** Giá gói: FIXED = giá nhập; SUM_MINUS_DISCOUNT = tổng giá lẻ trừ chiết khấu (% hoặc số tiền), không âm. */
export function computeServicePackagePrice(input: ComputeServicePackagePriceInput): ComputedServicePackagePrice {
  let retailTotal = 0;
  let unpricedItemCount = 0;
  for (const item of input.items) {
    if (item.unitPrice === null) unpricedItemCount += 1;
    else retailTotal += item.unitPrice * item.quantity;
  }
  let price: number | null;
  if (input.mode === 'FIXED') {
    price = input.fixedPrice;
  } else if (input.discountType === 'PERCENT') {
    price = Math.max(0, roundHalfUpDiv(retailTotal * (100 - Math.min(100, Math.max(0, input.discountValue ?? 0))), 100));
  } else if (input.discountType === 'AMOUNT') {
    price = Math.max(0, retailTotal - Math.max(0, input.discountValue ?? 0));
  } else {
    price = retailTotal;
  }
  return { price, retailTotal, unpricedItemCount, saving: price === null ? null : retailTotal - price };
}

// ---------------------------------------------------------------------------------------------
// Trạng thái bảng giá theo ngày
// ---------------------------------------------------------------------------------------------

export type PriceListStatus = 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'STOPPED';

/** Trạng thái của một bảng giá có thời hạn tại `today` (yyyy-mm-dd, giờ Việt Nam). `isActive=false` = đã bị "Ngừng bảng giá". */
export function computePriceListStatus(list: { isActive: boolean; effectiveFrom: string; effectiveTo: string }, today: string): PriceListStatus {
  if (!list.isActive) return 'STOPPED';
  if (today < list.effectiveFrom) return 'UPCOMING';
  if (today > list.effectiveTo) return 'EXPIRED';
  return 'ACTIVE';
}
