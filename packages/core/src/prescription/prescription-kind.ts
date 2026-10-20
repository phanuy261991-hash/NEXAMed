import type { DrugControlType, PrescriptionKind } from '@nexamed/shared';

/**
 * Loại đơn thuốc theo Bộ Y tế (docs/DECISIONS.md #242, giai đoạn 2) — C thông thường, N gây nghiện, H hướng thần và tiền chất, Y y học cổ truyền.
 *
 * Ánh xạ "loại thuốc → loại đơn" là cấu hình của phòng khám (bảng ánh xạ ở "Cấu hình hệ thống", sửa được); đây là hàm THUẦN nhận ánh xạ làm tham số.
 * Mặc định: gây nghiện → N; hướng thần và tiền chất → H (tài liệu liên thông QĐ 808 xếp tiền chất chung nhóm H); thuốc độc và thường → C; thuốc có cờ
 * "Đông y" → Y. Dòng kê tự do (không chọn từ danh mục) luôn là C.
 */
export type PrescriptionKindMapping = Record<DrugControlType | 'TRADITIONAL', PrescriptionKind>;

export const DEFAULT_PRESCRIPTION_KIND_MAPPING: PrescriptionKindMapping = {
  NARCOTIC: 'N',
  PSYCHOTROPIC: 'H',
  PRECURSOR: 'H',
  TOXIC: 'C',
  NORMAL: 'C',
  TRADITIONAL: 'Y',
};

/** Thứ tự ưu tiên khi MỘT thuốc khớp nhiều dòng của ánh xạ (ví dụ vừa gây nghiện vừa Đông y): N, rồi H, rồi Y, rồi C. */
const KIND_PRIORITY: Record<PrescriptionKind, number> = { N: 4, H: 3, Y: 2, C: 1 };

/** Thứ tự các đơn khi tách và in: C, N, H, Y. */
export const PRESCRIPTION_KIND_ORDER: readonly PrescriptionKind[] = ['C', 'N', 'H', 'Y'];

export interface PrescriptionKindInput {
  /** Dòng kê tự do (không có thuốc trong danh mục) — luôn loại C, không có cách đổi. */
  isFreeText: boolean;
  controlType?: DrugControlType | null;
  isTraditional?: boolean | null;
}

export function resolvePrescriptionKind(item: PrescriptionKindInput, mapping: PrescriptionKindMapping = DEFAULT_PRESCRIPTION_KIND_MAPPING): PrescriptionKind {
  if (item.isFreeText) return 'C';
  const candidates: PrescriptionKind[] = [mapping[item.controlType ?? 'NORMAL']];
  if (item.isTraditional) candidates.push(mapping.TRADITIONAL);
  return candidates.reduce((best, k) => (KIND_PRIORITY[k] > KIND_PRIORITY[best] ? k : best));
}

export interface PrescriptionKindGroup<T> {
  kind: PrescriptionKind;
  items: T[];
}

/** Nhóm dòng thuốc theo loại đơn, theo thứ tự C, N, H, Y; bỏ loại không có dòng nào. Giữ nguyên thứ tự dòng trong từng nhóm. */
export function groupByPrescriptionKind<T extends { kind: PrescriptionKind }>(items: T[]): PrescriptionKindGroup<T>[] {
  return PRESCRIPTION_KIND_ORDER.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);
}
