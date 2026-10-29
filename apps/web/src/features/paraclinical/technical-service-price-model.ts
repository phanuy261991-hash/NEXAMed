import { isDateRangeActiveToday } from '../../shared/format/date';

/**
 * Giá dịch vụ kỹ thuật = MỘT giá gốc (docs/DECISIONS.md #268). Bảng `technical_service_price` vẫn giữ cột Loại giá + khoảng ngày (không xoá cột, không mất
 * dữ liệu cũ), nhưng form chỉ còn MỘT ô giá + tuỳ chọn "Hẹn đổi giá từ ngày…". Module này là phần thuần: chọn "mức đang quản lý" (T), tách các dòng đang có thành
 * {giá hiện hành, giá hẹn, dòng ẩn}, rồi dựng lại MẢNG GỬI API. Lưu giá của API là "thay sạch" (`replacePrices` xoá mềm mọi dòng rồi ghi lại) nên mảng gửi
 * lên PHẢI mang theo cả các dòng ẩn nguyên vẹn — bỏ sót là mất mức giá cũ của công ty khác.
 */

export interface TechnicalServicePriceLine {
  priceTypeCode: string;
  unitCode: string;
  amount: number;
  effectiveFrom: string;
  effectiveTo?: string;
}

/**
 * Thứ tự ưu tiên của Loại giá: Loại giá MẶC ĐỊNH của phòng khám đứng đầu, rồi theo thứ tự danh mục. PHẢI khớp `PriceableCatalogService.priceTypeOrder` ở máy chủ
 * (mức máy chủ dùng để TÍNH TIỀN) — sửa một bên là sửa cả hai, nếu không form hiện một mức còn máy thu mức khác.
 */
export function rankPriceTypeCodes(catalogCodesInOrder: readonly string[], defaultCode: string): string[] {
  if (defaultCode === '') return [...catalogCodesInOrder];
  return [defaultCode, ...catalogCodesInOrder.filter((c) => c !== defaultCode)];
}

function rankOf(code: string, ranked: readonly string[]): number {
  const index = ranked.indexOf(code);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function compareByRank(a: string, b: string, ranked: readonly string[]): number {
  const d = rankOf(a, ranked) - rankOf(b, ranked);
  return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
}

/** Ngày liền trước `date` (yyyy-mm-dd) — tính thuần theo lịch, không dùng giờ máy. */
export function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Mức (Loại giá) mà form quản lý — cũng là mức máy chủ dùng để tính tiền: trong các mức đang có dòng giá HIỆU LỰC HÔM NAY lấy mức xếp đầu (mặc định trước);
 * không mức nào hiệu lực hôm nay thì lấy mức xếp đầu trong mọi dòng đang có; chưa có dòng nào thì `''` (nơi gọi tự chọn mức cho dịch vụ mới).
 */
export function chooseManagedPriceType(lines: readonly TechnicalServicePriceLine[], rankedAll: readonly string[], today: string): string {
  const pickFirst = (codes: Iterable<string>): string => [...new Set(codes)].sort((a, b) => compareByRank(a, b, rankedAll))[0] ?? '';
  const active = pickFirst(lines.filter((l) => isDateRangeActiveToday(l.effectiveFrom, l.effectiveTo, today)).map((l) => l.priceTypeCode));
  return active !== '' ? active : pickFirst(lines.map((l) => l.priceTypeCode));
}

export interface PriceFormModel {
  /** Mức đang quản lý (T). Rỗng = phòng khám chưa có Loại giá nào để gán. */
  priceTypeCode: string;
  /** Dòng của T đang hiệu lực hôm nay. */
  current: TechnicalServicePriceLine | null;
  /** Dòng của T hiệu lực SAU hôm nay, gần nhất ("Hẹn đổi giá"). */
  upcoming: TechnicalServicePriceLine | null;
  /** Mọi dòng còn lại (mức khác, dòng đã hết hạn, dòng hẹn thừa) — không ai sửa được, gửi lại NGUYÊN VẸN khi lưu. */
  hidden: TechnicalServicePriceLine[];
}

export function splitPriceLines(lines: readonly TechnicalServicePriceLine[], rankedAll: readonly string[], today: string, newServiceCode: string): PriceFormModel {
  const priceTypeCode = chooseManagedPriceType(lines, rankedAll, today) || newServiceCode;
  const ofType = lines.filter((l) => l.priceTypeCode === priceTypeCode);
  const current = ofType.filter((l) => isDateRangeActiveToday(l.effectiveFrom, l.effectiveTo, today)).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null;
  const upcoming = ofType.filter((l) => l.effectiveFrom > today).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0] ?? null;
  const hidden = lines.filter((l) => l !== current && l !== upcoming);
  return { priceTypeCode, current, upcoming, hidden };
}

export interface PriceFormInput {
  amount: number | undefined;
  unitCode: string;
  scheduleEnabled: boolean;
  scheduleAmount: number | undefined;
  scheduleFrom: string;
}

/** Giá trị ban đầu của các ô trong form, lấy từ mô hình. */
export function initialPriceFormInput(model: PriceFormModel): PriceFormInput {
  return {
    amount: model.current?.amount,
    unitCode: model.current?.unitCode ?? model.upcoming?.unitCode ?? '',
    scheduleEnabled: model.upcoming !== null,
    scheduleAmount: model.upcoming?.amount,
    scheduleFrom: model.upcoming?.effectiveFrom ?? '',
  };
}

function withOptionalEnd(line: Omit<TechnicalServicePriceLine, 'effectiveTo'>, effectiveTo: string | undefined): TechnicalServicePriceLine {
  return effectiveTo ? { ...line, effectiveTo } : { ...line };
}

/** Mảng đơn giá gửi API sau khi người dùng sửa form: [giá hiện hành, giá hẹn, ...dòng ẩn nguyên vẹn]. */
export function buildPriceLines(model: PriceFormModel, input: PriceFormInput, today: string): TechnicalServicePriceLine[] {
  const type = model.priceTypeCode;
  const schedule: TechnicalServicePriceLine | null =
    input.scheduleEnabled && input.scheduleAmount !== undefined && input.scheduleFrom !== ''
      ? withOptionalEnd({ priceTypeCode: type, unitCode: input.unitCode, amount: input.scheduleAmount, effectiveFrom: input.scheduleFrom }, model.upcoming?.effectiveTo)
      : null;

  let current: TechnicalServicePriceLine | null = null;
  if (input.amount !== undefined) {
    let effectiveTo: string | undefined;
    if (schedule) {
      effectiveTo = dayBefore(schedule.effectiveFrom);
    } else if (model.upcoming && model.current?.effectiveTo === dayBefore(model.upcoming.effectiveFrom)) {
      // Bỏ tích "Hẹn đổi giá": dòng hiện hành mở lại (vô thời hạn) vì ngày kết thúc của nó chỉ do lần hẹn đó đặt ra.
      effectiveTo = undefined;
    } else {
      effectiveTo = model.current?.effectiveTo;
    }
    current = withOptionalEnd({ priceTypeCode: type, unitCode: input.unitCode, amount: input.amount, effectiveFrom: model.current?.effectiveFrom ?? today }, effectiveTo);
  }

  return [...(current ? [current] : []), ...(schedule ? [schedule] : []), ...model.hidden.map((l) => ({ ...l }))];
}

function rangesOverlap(a: TechnicalServicePriceLine, b: TechnicalServicePriceLine): boolean {
  return a.effectiveFrom <= (b.effectiveTo ?? '9999-12-31') && b.effectiveFrom <= (a.effectiveTo ?? '9999-12-31');
}

/** Lỗi nhập của khối giá (null = hợp lệ). Chỉ kiểm khi dịch vụ thực hiện tại phòng khám — chỉ định ra ngoài không có giá. */
export function validatePriceForm(model: PriceFormModel, input: PriceFormInput, today: string, inHouse: boolean): string | null {
  if (!inHouse) return null;
  if (model.priceTypeCode === '') return 'Phòng khám chưa có Loại giá dịch vụ nào — thêm ở Danh mục dùng chung trước khi khai giá.';
  if (input.amount === undefined) return 'Nhập Đơn giá cho dịch vụ.';
  if (input.unitCode === '') return 'Chọn Đơn vị tính.';
  if (input.scheduleEnabled) {
    if (input.scheduleAmount === undefined) return 'Hẹn đổi giá cần nhập Giá mới.';
    if (input.scheduleFrom === '') return 'Hẹn đổi giá cần chọn ngày áp dụng.';
    if (input.scheduleFrom <= today) return 'Ngày áp dụng giá mới phải sau hôm nay.';
  }
  const lines = buildPriceLines(model, input, today);
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i]!;
      const b = lines[j]!;
      if (a.priceTypeCode === b.priceTypeCode && rangesOverlap(a, b)) return 'Khoảng ngày của giá này trùng với một mức giá cũ đã ẩn của dịch vụ.';
    }
  }
  return null;
}

/** Mã các Loại giá KHÁC mức đang quản lý mà dịch vụ còn dòng giá (đã ẩn khỏi form) — để báo "còn N mức giá cũ đã ẩn". */
export function hiddenOtherPriceTypeCodes(model: PriceFormModel): string[] {
  return [...new Set(model.hidden.map((l) => l.priceTypeCode).filter((c) => c !== model.priceTypeCode))];
}
