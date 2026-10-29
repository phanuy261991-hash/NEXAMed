import type { DrugDosePresetInput, DrugSummary } from '@nexamed/shared';
import { parseDoseInput } from '../encounter/prescription-dose-preview';

/**
 * Cấu hình "Cách kê liều" của thuốc ở form Thuốc (docs/DECISIONS.md #267, mockup màn 1). Hàm thuần: đổi giữa chuỗi người dùng gõ (có thể gõ dở, "2,5", "1/2") và dữ liệu gửi lên máy chủ.
 * Liều mẫu cùng bước ¼ với liều của dòng đơn; dung tích ("mỗi Hộp chứa 60 ml") cũng là bội của ¼.
 */
export const MAX_DOSE_PRESETS = 8;

/** Một dòng liều mẫu trong form — giữ CHUỖI để gõ dở không bị mất. */
export interface DosePresetRow {
  name: string;
  doseMorning: string;
  doseNoon: string;
  doseAfternoon: string;
  doseEvening: string;
}

export const EMPTY_DOSE_PRESET_ROW: DosePresetRow = { name: '', doseMorning: '', doseNoon: '', doseAfternoon: '', doseEvening: '' };

const DOSE_FIELDS = ['doseMorning', 'doseNoon', 'doseAfternoon', 'doseEvening'] as const;

/** 2,5 → "2,5"; 10 → "10" (kiểu số Việt, không dùng ký hiệu ½ vì đơn vị liều có thể là ml). */
export function formatDoseNumber(value: number): string {
  return String(value).replace('.', ',');
}

export function presetRowsFromItem(item: Pick<DrugSummary, 'dosePresets'> | undefined): DosePresetRow[] {
  return (item?.dosePresets ?? []).map((p) => ({
    name: p.name,
    doseMorning: p.doseMorning > 0 ? formatDoseNumber(p.doseMorning) : '',
    doseNoon: p.doseNoon > 0 ? formatDoseNumber(p.doseNoon) : '',
    doseAfternoon: p.doseAfternoon > 0 ? formatDoseNumber(p.doseAfternoon) : '',
    doseEvening: p.doseEvening > 0 ? formatDoseNumber(p.doseEvening) : '',
  }));
}

/** Dòng bỏ trống hoàn toàn (không tên, không liều) — lúc lưu bị bỏ qua, không báo lỗi (như dòng quy đổi đơn vị trống). */
export function isPresetRowEmpty(row: DosePresetRow): boolean {
  return row.name.trim() === '' && DOSE_FIELDS.every((f) => row[f].trim() === '');
}

/** Dung tích "mỗi đơn vị nhỏ nhất chứa bao nhiêu đơn vị liều": số dương, bội của ¼ (gõ "60", "2,5"). `null` = không hợp lệ hoặc để trống. */
export function parseDosePerBaseUnit(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '' || !/^\d*\.?\d+$/.test(t)) return null;
  const value = Number(t);
  if (!Number.isFinite(value) || value < 0.25 || value > 100000) return null;
  return Math.abs(value * 4 - Math.round(value * 4)) < 1e-9 ? value : null;
}

/** Một ô liều: để trống = 0; sai định dạng/không phải bội ¼ = `null`. */
function parseCell(text: string): number | null {
  const parsed = parseDoseInput(text);
  if (parsed === '') return 0;
  return parsed;
}

export interface DoseConfigIssue {
  /** Chỉ số dòng liều mẫu bị lỗi, hoặc `null` nếu lỗi ở đơn vị liều/dung tích. */
  row: number | null;
  message: string;
}

/**
 * Lỗi cấu hình liều hiện tại (rỗng = hợp lệ): đơn vị liều và dung tích cùng có hoặc cùng không; mỗi dòng liều mẫu có tên + liều hợp lệ (bội ¼) + ít nhất một buổi > 0; tên không trùng.
 * Khớp luật của máy chủ (`checkDoseConfig`, `drugDosePresetInputSchema`) để báo lỗi sớm tại form.
 */
export function validateDoseConfig(input: { doseUnitCode: string; dosePerBaseUnit: string; rows: DosePresetRow[] }): DoseConfigIssue[] {
  const issues: DoseConfigIssue[] = [];
  const hasUnit = input.doseUnitCode.trim() !== '';
  const per = parseDosePerBaseUnit(input.dosePerBaseUnit);
  if (hasUnit && per === null) {
    issues.push({ row: null, message: input.dosePerBaseUnit.trim() === '' ? 'Nhập "Mỗi đơn vị bán chứa bao nhiêu" khi đã chọn đơn vị liều.' : 'Dung tích phải là số dương, bội của ¼ (ví dụ 60 hoặc 2,5).' });
  }
  if (!hasUnit && input.dosePerBaseUnit.trim() !== '') issues.push({ row: null, message: 'Chọn đơn vị liều khi đã nhập dung tích.' });

  const seen = new Set<string>();
  input.rows.forEach((row, index) => {
    if (isPresetRowEmpty(row)) return;
    const name = row.name.trim();
    if (name === '') {
      issues.push({ row: index, message: 'Nhập tên nhóm (ví dụ Người lớn).' });
      return;
    }
    const cells = DOSE_FIELDS.map((f) => parseCell(row[f]));
    if (cells.some((c) => c === null)) {
      issues.push({ row: index, message: `Liều của "${name}" phải là số, bội của ¼ (ví dụ 2,5 hoặc 10).` });
      return;
    }
    if (cells.every((c) => c === 0)) issues.push({ row: index, message: `"${name}" phải có ít nhất một buổi lớn hơn 0.` });
    const key = name.toLocaleLowerCase('vi-VN');
    if (seen.has(key)) issues.push({ row: index, message: `Tên nhóm "${name}" bị trùng.` });
    seen.add(key);
  });
  return issues;
}

/** Dữ liệu gửi máy chủ — bỏ dòng trống. Chỉ gọi khi `validateDoseConfig` không còn lỗi. */
export function buildDosePresets(rows: DosePresetRow[]): DrugDosePresetInput[] {
  return rows
    .filter((row) => !isPresetRowEmpty(row))
    .map((row) => ({
      name: row.name.trim(),
      doseMorning: parseCell(row.doseMorning) ?? 0,
      doseNoon: parseCell(row.doseNoon) ?? 0,
      doseAfternoon: parseCell(row.doseAfternoon) ?? 0,
      doseEvening: parseCell(row.doseEvening) ?? 0,
    }));
}

/** Chuỗi tóm tắt một liều mẫu: "Sáng 10 - Tối 10 ml" (bỏ buổi bằng 0). */
export function summarizePreset(preset: Pick<DrugDosePresetInput, 'doseMorning' | 'doseNoon' | 'doseAfternoon' | 'doseEvening'>, unitLabel: string): string {
  const parts: string[] = [];
  if (preset.doseMorning > 0) parts.push(`Sáng ${formatDoseNumber(preset.doseMorning)}`);
  if (preset.doseNoon > 0) parts.push(`Trưa ${formatDoseNumber(preset.doseNoon)}`);
  if (preset.doseAfternoon > 0) parts.push(`Chiều ${formatDoseNumber(preset.doseAfternoon)}`);
  if (preset.doseEvening > 0) parts.push(`Tối ${formatDoseNumber(preset.doseEvening)}`);
  return `${parts.join(' - ')}${unitLabel ? ` ${unitLabel}` : ''}`.trim();
}
