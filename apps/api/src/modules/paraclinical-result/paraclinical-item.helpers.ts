import type { ParaclinicalItemStatus } from '@nexamed/core';
import { specimenCapColorSchema, type SpecimenCapColor } from '@nexamed/shared';
import type { QueueItemRow } from '../clinical-order/clinical-order.repository';

/**
 * Hàm thuần dùng chung cho hàng đợi cận lâm sàng và lấy mẫu xét nghiệm (docs/DECISIONS.md #212/#220): biến dòng chỉ định thô thành dòng "đã làm giàu" (loại dịch vụ, trạng thái, đã thu tiền hay chưa).
 */
export type Gender = 'male' | 'female' | 'other';

export interface EnrichedItem {
  row: QueueItemRow;
  id: string;
  clinicalOrderId: string;
  serviceKind: 'LAB' | 'IMAGING' | 'FUNCTIONAL';
  status: ParaclinicalItemStatus;
  paid: boolean;
}

export function toGender(raw: string): Gender | null {
  return raw === 'male' || raw === 'female' || raw === 'other' ? raw : null;
}

/** Dòng chỉ định đã thu tiền: dòng hoá đơn của chính nó (lẻ) hoặc của gói chứa nó, và MỌI dòng đó nằm trên hoá đơn `PAID`. */
export function isPaid(row: QueueItemRow): boolean {
  const lines = row.clinicalOrderPackageId === null ? row.invoiceLines : (row.package?.invoiceLines ?? []);
  return lines.length > 0 && lines.every((l) => l.invoice.status === 'PAID');
}

export function enrich(rows: QueueItemRow[]): EnrichedItem[] {
  return rows
    .filter((r) => r.technicalService !== null)
    .map((row) => ({
      row,
      id: row.id,
      clinicalOrderId: row.clinicalOrderId,
      serviceKind: row.technicalService!.serviceKind,
      status: row.status as ParaclinicalItemStatus,
      paid: isPaid(row),
    }));
}

/** Mã màu nắp ống đọc từ DB (chuỗi tự do) → giá trị hợp lệ, không hợp lệ/trống thì `null`. */
export function asCapColor(raw: string | null | undefined): SpecimenCapColor | null {
  return specimenCapColorSchema.safeParse(raw).success ? (raw as SpecimenCapColor) : null;
}
