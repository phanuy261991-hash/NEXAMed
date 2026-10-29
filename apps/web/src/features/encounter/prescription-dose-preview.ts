/**
 * Bản sao THUẦN CLIENT của `computePrescriptionQuantity`/`formatDoseSummary`/`formatDoseAmount`
 * (`packages/shared/src/prescription.ts`) — khai lại tại đây thay vì import từ `@nexamed/shared` vì
 * Rollup không dò được các export hàm thuần này qua `__exportStar` lúc `vite build` (dù `tsc`/Node
 * thấy đúng), cùng lỗi bundler đã gặp nhiều lần trong dự án (docs/DECISIONS.md #032/#091/#114). Số
 * lượng THẬT lúc lưu luôn do backend tính lại — các hàm này chỉ dùng để xem trước/hiển thị ở web.
 * Sửa logic ở bản gốc thì PHẢI sửa lại y hệt ở đây.
 *
 * Liều lẻ (#241): bước nhỏ nhất ¼ viên, mọi phép cộng/nhân đi qua SỐ NGUYÊN theo đơn vị ¼ viên.
 */
export interface PrescriptionDosePeriodsPreview {
  doseMorning: number;
  doseNoon: number;
  doseAfternoon: number;
  doseEvening: number;
}

/** Liều → số nguyên đơn vị ¼ viên (1 viên = 4). */
export function doseToQuartersPreview(dose: number): number {
  return Math.round(dose * 4);
}

/** Tổng theo đơn vị ¼ viên (số nguyên) trước khi làm tròn. */
export function computePrescriptionExactQuartersPreview(periods: PrescriptionDosePeriodsPreview, durationDays: number): number {
  const perDay =
    doseToQuartersPreview(periods.doseMorning) +
    doseToQuartersPreview(periods.doseNoon) +
    doseToQuartersPreview(periods.doseAfternoon) +
    doseToQuartersPreview(periods.doseEvening);
  return perDay * durationDays;
}

/** Bao nhiêu "¼ đơn vị liều" thì tròn 1 đơn vị nhỏ nhất — khớp `quartersPerBaseUnit` ở shared (viên/gói = 4; dung dịch 60 ml/Hộp = 240). */
export function quartersPerBaseUnitPreview(dosePerBaseUnit?: number | null): number {
  return dosePerBaseUnit && dosePerBaseUnit > 0 ? Math.max(1, Math.round(dosePerBaseUnit * 4)) : 4;
}

/** Tổng số nguyên đã LÀM TRÒN LÊN — khớp `computePrescriptionQuantity` ở backend. */
export function computePrescriptionQuantityPreview(periods: PrescriptionDosePeriodsPreview, durationDays: number, dosePerBaseUnit?: number | null): number {
  return Math.ceil(computePrescriptionExactQuartersPreview(periods, durationDays) / quartersPerBaseUnitPreview(dosePerBaseUnit));
}

/** Liều một buổi dạng đọc được: 0,5 → "½", 1,5 → "1½", 2 → "2", 0,25 → "¼". */
export function formatDoseAmountPreview(dose: number): string {
  const quarters = doseToQuartersPreview(dose);
  const whole = Math.floor(quarters / 4);
  const frac = ['', '¼', '½', '¾'][quarters % 4] ?? '';
  if (whole === 0 && frac === '') return '0';
  return `${whole > 0 ? whole : ''}${frac}`;
}

/** Liều dạng số thập phân kiểu Việt cho đơn vị liều không phải viên (ml...): 2.5 → "2,5". Khớp `formatDoseDecimal` ở shared. */
export function formatDoseDecimalPreview(dose: number): string {
  return String(Math.round(dose * 100) / 100).replace('.', ',');
}

export function formatDoseSummaryPreview(periods: PrescriptionDosePeriodsPreview, doseUnit?: string | null): string {
  const amount = doseUnit ? formatDoseDecimalPreview : formatDoseAmountPreview;
  const suffix = doseUnit ? ` ${doseUnit}` : '';
  const parts: string[] = [];
  if (periods.doseMorning > 0) parts.push(`Sáng ${amount(periods.doseMorning)}${suffix}`);
  if (periods.doseNoon > 0) parts.push(`Trưa ${amount(periods.doseNoon)}${suffix}`);
  if (periods.doseAfternoon > 0) parts.push(`Chiều ${amount(periods.doseAfternoon)}${suffix}`);
  if (periods.doseEvening > 0) parts.push(`Tối ${amount(periods.doseEvening)}${suffix}`);
  return parts.length > 0 ? parts.join(' - ') : '—';
}

/** Cột "Liều dùng" cho nơi chỉ đọc — khớp `formatPrescriptionDose` ở shared ("Sáng 5 ml - Tối 5 ml" / "Mỗi lần 1,5 gói, khi cần"). */
export function formatPrescriptionDosePreview(
  item: PrescriptionDosePeriodsPreview & { doseMode?: 'SCHEDULED' | 'AS_NEEDED' | null; singleDose?: number | null; doseUnitName?: string | null; unitName?: string | null },
): string {
  if (item.doseMode === 'AS_NEEDED') {
    const dose = item.singleDose ?? 0;
    if (dose <= 0) return 'Khi cần';
    const unit = item.doseUnitName ?? item.unitName?.trim().toLocaleLowerCase('vi-VN') ?? '';
    return `Mỗi lần ${formatDoseDecimalPreview(dose)}${unit ? ` ${unit}` : ''}, khi cần`;
  }
  return formatDoseSummaryPreview(item, item.doseUnitName);
}

/** Có liều lẻ (không phải số nguyên viên) ở ít nhất một buổi. */
export function hasFractionalDosePreview(periods: PrescriptionDosePeriodsPreview): boolean {
  return [periods.doseMorning, periods.doseNoon, periods.doseAfternoon, periods.doseEvening].some((d) => doseToQuartersPreview(d) % 4 !== 0);
}

/** Số thập phân kiểu Việt cho tổng lẻ: 10 → "2,5". */
export function formatQuarterTotalVi(quarters: number): string {
  return String(Math.round((quarters / 4) * 100) / 100).replace('.', ',');
}

const GLYPH_VALUE: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };

/**
 * Đọc liều người dùng gõ: `0,5` / `0.5` / `1/2` / `1 1/2` / `½` / `1½`. Trả `''` nếu để trống, `null` nếu không hợp lệ
 * (không phải bội của ¼ hoặc sai định dạng) — nơi gọi quay về giá trị cũ.
 */
export function parseDoseInput(text: string): number | '' | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return '';
  let value: number;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+)?\s*([¼½¾])$/))) {
    value = (m[1] ? Number(m[1]) : 0) + (GLYPH_VALUE[m[2]!] ?? 0);
  } else if ((m = t.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/))) {
    if (Number(m[3]) === 0) return null;
    value = (m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]);
  } else if (/^\d*\.?\d+$/.test(t)) {
    value = parseFloat(t);
  } else {
    return null;
  }
  if (!Number.isFinite(value) || value > 99.75) return null;
  return Math.abs(value * 4 - Math.round(value * 4)) < 1e-9 ? value : null;
}
