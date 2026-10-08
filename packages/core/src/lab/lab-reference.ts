import { stripVietnameseDiacritics } from '../search/strip-vietnamese-diacritics';

/**
 * Khoảng tham chiếu chỉ số xét nghiệm theo (giới tính × khoảng tuổi) — logic thuần của Cận lâm sàng GĐ1
 * (docs/DECISIONS.md #212), dùng lại ở GĐ4 lúc nhập/in kết quả. Tách khỏi controller/component theo CLAUDE.md.
 */
export type LabReferenceSex = 'ANY' | 'MALE' | 'FEMALE';
export type LabIndicatorValueType = 'NUMBER' | 'TEXT' | 'CHOICE';
export type LabValueFlag = 'LOW' | 'HIGH' | 'NORMAL' | 'ABNORMAL';

export interface LabReferenceRow {
  sex: LabReferenceSex;
  ageFromYears: number;
  /** null = không giới hạn trên. */
  ageToYears: number | null;
  lowValue: number | null;
  highValue: number | null;
  lowInclusive: boolean;
  highInclusive: boolean;
  normalText: string | null;
  displayText: string | null;
}

export interface LabPatientContext {
  /** Giới tính hồ sơ bệnh nhân (`patient.gender`) — 'other'/không rõ chỉ khớp dòng `ANY`. */
  gender: 'male' | 'female' | 'other' | null | undefined;
  /** Tuổi tròn năm; null = chưa biết ngày sinh. */
  ageYears: number | null;
}

function sexMatches(row: LabReferenceRow, gender: LabPatientContext['gender']): boolean {
  if (row.sex === 'ANY') return true;
  if (row.sex === 'MALE') return gender === 'male';
  return gender === 'female';
}

function ageMatches(row: LabReferenceRow, ageYears: number | null): boolean {
  if (ageYears === null) {
    // Chưa biết tuổi → chỉ chấp nhận dòng không ràng buộc tuổi (0 → không giới hạn).
    return row.ageFromYears === 0 && row.ageToYears === null;
  }
  return ageYears >= row.ageFromYears && (row.ageToYears === null || ageYears <= row.ageToYears);
}

/**
 * Chọn dòng tham chiếu áp dụng cho bệnh nhân. Dòng CỤ THỂ hơn thắng: giới tính cụ thể (MALE/FEMALE) hơn `ANY`,
 * rồi tới khoảng tuổi HẸP hơn (không giới hạn trên = rộng nhất); hoà thì dòng đứng trước trong danh sách thắng.
 * Trả null nếu không dòng nào khớp.
 */
export function selectLabReference(rows: readonly LabReferenceRow[], patient: LabPatientContext): LabReferenceRow | null {
  let best: LabReferenceRow | null = null;
  let bestKey: [number, number] | null = null;
  for (const row of rows) {
    if (!sexMatches(row, patient.gender) || !ageMatches(row, patient.ageYears)) continue;
    const sexSpecific = row.sex === 'ANY' ? 0 : 1;
    const ageWidth = row.ageToYears === null ? Number.POSITIVE_INFINITY : row.ageToYears - row.ageFromYears;
    // So khoảng cách: ưu tiên sexSpecific lớn hơn; cùng nhau thì ageWidth nhỏ hơn.
    if (
      bestKey === null ||
      sexSpecific > bestKey[0] ||
      (sexSpecific === bestKey[0] && ageWidth < bestKey[1])
    ) {
      best = row;
      bestKey = [sexSpecific, ageWidth];
    }
  }
  return best;
}

/** Chuẩn hoá số nhập tay: chấp nhận dấu phẩy thập phân kiểu Việt ("5,3"). Trả null nếu không phải số hữu hạn. */
export function parseLabNumber(raw: string | number): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value: string): string {
  return stripVietnameseDiacritics(value).trim().replace(/\s+/g, ' ');
}

/**
 * Gắn cờ kết quả so với khoảng tham chiếu. NUMBER: so ngưỡng (tôn trọng bao gồm/không bao gồm từng đầu);
 * TEXT/CHOICE: so khớp `normalText` (không phân biệt hoa/thường/dấu). Không có tham chiếu/ngưỡng → null (không kết luận).
 */
export function evaluateLabValue(valueType: LabIndicatorValueType, raw: string | number, reference: LabReferenceRow | null): LabValueFlag | null {
  if (reference === null) return null;

  if (valueType === 'NUMBER') {
    const value = parseLabNumber(raw);
    if (value === null) return null;
    const { lowValue, highValue } = reference;
    if (lowValue === null && highValue === null) return null;
    if (lowValue !== null && (value < lowValue || (value === lowValue && !reference.lowInclusive))) return 'LOW';
    if (highValue !== null && (value > highValue || (value === highValue && !reference.highInclusive))) return 'HIGH';
    return 'NORMAL';
  }

  if (reference.normalText === null || reference.normalText.trim() === '') return null;
  const text = String(raw);
  if (text.trim() === '') return null;
  return normalizeText(text).toLowerCase() === normalizeText(reference.normalText).toLowerCase() ? 'NORMAL' : 'ABNORMAL';
}

function formatNumber(n: number, decimals: number | null | undefined): string {
  if (decimals !== null && decimals !== undefined) return n.toFixed(decimals);
  return String(n);
}

/**
 * Chữ khoảng tham chiếu để IN: ưu tiên `displayText` người dùng tự gõ (có thể nhiều dòng); trống thì tự sinh từ
 * ngưỡng ("4 - 10", "< 0.03", "≥ 90"); chỉ số chữ thì dùng `normalText`.
 */
export function formatLabReferenceText(reference: LabReferenceRow | null, decimals?: number | null): string {
  if (reference === null) return '';
  if (reference.displayText !== null && reference.displayText.trim() !== '') return reference.displayText;

  const { lowValue, highValue } = reference;
  if (lowValue !== null && highValue !== null) {
    return `${formatNumber(lowValue, decimals)} - ${formatNumber(highValue, decimals)}`;
  }
  if (highValue !== null) return `${reference.highInclusive ? '≤' : '<'} ${formatNumber(highValue, decimals)}`;
  if (lowValue !== null) return `${reference.lowInclusive ? '≥' : '>'} ${formatNumber(lowValue, decimals)}`;
  return reference.normalText ?? '';
}
