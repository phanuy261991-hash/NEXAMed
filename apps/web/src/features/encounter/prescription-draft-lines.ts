import type { PrescriptionItem } from '@nexamed/shared';
import type { DoseLineState } from './DoseLineEditor';
import { singleDoseText } from './prescription-dose-preview';

/**
 * Một dòng thuốc đang soạn. Liều theo buổi Sáng/Trưa/Chiều/Tối (docs/DECISIONS.md #196) hoặc kiểu "Khi cần" (#267: liều mỗi lần + số lượng nhập thẳng); số lượng của "Theo buổi" luôn TÍNH RA
 * (không nhập tay), theo đơn vị NHỎ NHẤT của thuốc (`unitCode` — CHỈ hiển thị, không có ô chọn đơn vị nào).
 */
export type DraftLine = DoseLineState & {
  /** Số ngày đã sửa RIÊNG (#241) — không đổi theo "số ngày chung" (số ngày của thuốc "Theo buổi" đầu tiên) nữa. Luôn `false` ở dòng đầu. */
  daysOwn: boolean;
};

export const DEFAULT_DURATION_DAYS = '5';

/** Dòng giữ "số ngày chung" của đơn = thuốc "Theo buổi" ĐẦU TIÊN (dòng "Khi cần" không có số ngày nên không làm chuẩn). */
export function masterLineOf(lines: DraftLine[]): DraftLine | undefined {
  return lines.find((l) => l.doseMode === 'SCHEDULED');
}

/** Số ngày chung của đơn = số ngày của thuốc "Theo buổi" đầu tiên (chốt qua mockup #241); chưa có thì mặc định 5. */
export function masterDaysOf(lines: DraftLine[]): string {
  return masterLineOf(lines)?.durationDays ?? DEFAULT_DURATION_DAYS;
}

/** Đánh dấu "chỉnh riêng" cho dòng có số ngày khác số ngày chung — dùng khi nạp cả cụm dòng (đơn đã lưu, đơn mẫu, đơn lần trước). */
export function markDaysOwn(lines: DraftLine[]): DraftLine[] {
  const master = masterLineOf(lines);
  const masterDays = masterDaysOf(lines);
  return lines.map((l) => ({ ...l, daysOwn: l.doseMode === 'SCHEDULED' && l !== master && l.durationDays !== masterDays }));
}

/** Dòng đã lưu → dòng đang soạn; mang theo kiểu kê (#267): "Khi cần" giữ liều mỗi lần + số lượng, không có số ngày (lấy số ngày mặc định để đổi sang "Theo buổi" được). */
export function itemToDraft(item: PrescriptionItem): DraftLine {
  return {
    key: item.id,
    drugId: item.drugId,
    drugName: item.drugName,
    unitCode: item.unitCode,
    doseMode: item.doseMode,
    doseMorning: String(item.doseMorning),
    doseNoon: String(item.doseNoon),
    doseAfternoon: String(item.doseAfternoon),
    doseEvening: String(item.doseEvening),
    durationDays: item.durationDays === null ? DEFAULT_DURATION_DAYS : String(item.durationDays),
    singleDose: singleDoseText(item.singleDose),
    quantity: item.doseMode === 'AS_NEEDED' ? String(item.quantity) : '',
    instruction: item.instruction ?? '',
    isSplittable: item.isSplittable,
    daysOwn: false,
  };
}

/**
 * "Sao chép đơn thuốc lần khám trước" (docs/DECISIONS.md #196): thêm CẢ CỤM dòng của đơn đã ký gần nhất vào cuối đơn đang soạn,
 * bỏ qua thuốc đã có sẵn trong đơn (so theo `drugId`, tránh trùng). Dòng sao chép nhận khoá mới (`makeKey`) để không đụng id dòng cũ,
 * giữ nguyên kiểu kê và số ngày của từng dòng (khác số ngày chung thì thành "chỉnh riêng").
 */
export function appendPreviousPrescriptionItems(draftLines: DraftLine[], previousItems: PrescriptionItem[], makeKey: () => string): DraftLine[] {
  const existingIds = new Set(draftLines.map((l) => l.drugId));
  const additions = previousItems.filter((item) => !existingIds.has(item.drugId)).map((item) => ({ ...itemToDraft(item), key: makeKey() }));
  return markDaysOwn([...draftLines, ...additions]);
}
