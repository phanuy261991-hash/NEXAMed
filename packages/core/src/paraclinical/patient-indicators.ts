/**
 * Diễn biến chỉ số xét nghiệm theo bệnh nhân (docs/DECISIONS.md #234) — hàm thuần, không phụ thuộc framework.
 * Gộp các lần đo của cùng một chỉ số theo MÃ chỉ số + ĐƠN VỊ: đổi đơn vị giữa các lần đo thì tách thành hai nhóm riêng (không quy đổi, tránh sai số).
 */

/** Chỉ số cần từ bấy nhiêu lần đo trở lên mới tính là "theo dõi được" ở dải số của tab. */
export const TRACKABLE_MIN_MEASURES = 3;

export interface IndicatorMeasure {
  code: string;
  unit: string | null;
  name: string;
  /** Tên nhóm dịch vụ chứa chỉ số (SINH HOÁ, HUYẾT HỌC...); `null` nếu chưa phân nhóm. */
  groupName: string | null;
  /** Mốc duyệt kết quả, mili-giây UTC. */
  signedAtMs: number;
  /** Giá trị đã chuẩn hoá thành số (người gọi chỉ đưa vào chỉ số dạng số, giá trị đọc được). */
  value: number;
}

export interface IndicatorGroup<T extends IndicatorMeasure> {
  code: string;
  unit: string | null;
  /** Tên của lần đo MỚI NHẤT (tên chỉ số có thể được sửa trong danh mục theo thời gian). */
  name: string;
  groupName: string | null;
  /** Cũ → mới. */
  measures: T[];
}

/** Đơn vị rỗng/khoảng trắng coi như không ghi đơn vị. */
export function normalizeIndicatorUnit(unit: string | null | undefined): string | null {
  const trimmed = unit?.trim();
  return trimmed ? trimmed : null;
}

export function indicatorKey(code: string, unit: string | null | undefined): string {
  return `${code}\u0000${normalizeIndicatorUnit(unit) ?? ''}`;
}

/** Nhóm các lần đo theo (mã, đơn vị); nhóm sắp theo tên nhóm dịch vụ rồi tên chỉ số (tiếng Việt), lần đo sắp cũ → mới. */
export function groupIndicatorMeasures<T extends IndicatorMeasure>(measures: T[]): IndicatorGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const m of measures) {
    const key = indicatorKey(m.code, m.unit);
    const list = byKey.get(key);
    if (list) list.push(m);
    else byKey.set(key, [m]);
  }
  const groups: IndicatorGroup<T>[] = [];
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => a.signedAtMs - b.signedAtMs);
    const latest = sorted[sorted.length - 1]!;
    groups.push({ code: latest.code, unit: normalizeIndicatorUnit(latest.unit), name: latest.name, groupName: latest.groupName, measures: sorted });
  }
  return groups.sort((a, b) => (a.groupName ?? '￿').localeCompare(b.groupName ?? '￿', 'vi') || a.name.localeCompare(b.name, 'vi'));
}

export function countTrackableIndicators(groups: IndicatorGroup<IndicatorMeasure>[]): number {
  return groups.filter((g) => g.measures.length >= TRACKABLE_MIN_MEASURES).length;
}
