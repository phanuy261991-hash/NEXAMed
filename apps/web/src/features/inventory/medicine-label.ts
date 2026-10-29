import type { MedicineLabelItem } from '@nexamed/shared';
import { padSmallQuantity } from '../../shared/format/pad-small-quantity';
import { formatDoseSummaryPreview } from '../encounter/prescription-dose-preview';

/**
 * Ghép chữ lên "Nhãn dán bì thuốc" (docs/DECISIONS.md #267, mockup đã chốt 28/10/2026) từ dữ liệu thô của `GET /inventory/issues/:id/medicine-labels`.
 * Hàm thuần, đặt riêng để test được và dùng chung cho tờ in lẫn bảng xem trước.
 */

export { padSmallQuantity };

/** "05 Gói", "01 Hộp" — đơn vị để trống thì chỉ có số. */
export function formatLabelQuantity(quantity: number, unitName: string | null | undefined): string {
  return `${padSmallQuantity(quantity)} ${unitName ?? ''}`.trim();
}

function compact(text: string): string {
  return text.toLocaleLowerCase('vi-VN').replace(/\s+/g, '');
}

/**
 * Tên thuốc kèm hoạt chất/hàm lượng: "Zyrtec Sol 60ml (Cetirizin dihydroclorid 1mg/ml)". Phần nào đã nằm sẵn trong tên thuốc (so không phân biệt hoa/thường và khoảng trắng) thì bỏ — tránh in lặp.
 */
export function buildMedicineLabelTitle(item: Pick<MedicineLabelItem, 'drugName' | 'activeIngredient' | 'concentration'>): string {
  const name = item.drugName.trim();
  const haystack = compact(name);
  const details = [item.activeIngredient, item.concentration]
    .map((d) => d?.trim() ?? '')
    .filter((d) => d !== '' && !haystack.includes(compact(d)));
  return details.length > 0 ? `${name} (${details.join(' ')})` : name;
}

/**
 * Câu dặn trên nhãn: liều theo buổi + số ngày (nếu có liều), rồi hướng dẫn bác sĩ gõ. Hàng không theo đơn không có câu dặn (`null`).
 * Ví dụ: "Sáng 1 - Tối 1, 5 ngày. Uống sau ăn." / chỉ hướng dẫn: "Uống 1,5 gói khi sốt cao…".
 */
export function buildMedicineLabelInstruction(item: Pick<MedicineLabelItem, 'doseMorning' | 'doseNoon' | 'doseAfternoon' | 'doseEvening' | 'durationDays' | 'instruction'>): string | null {
  const doses = formatDoseSummaryPreview(item);
  const hasDose = doses !== '—';
  const dosePart = hasDose ? `${doses}${item.durationDays ? `, ${item.durationDays} ngày` : ''}` : '';
  const instruction = item.instruction?.trim() ?? '';
  if (dosePart && instruction) return `${dosePart}. ${instruction}`;
  if (dosePart) return `${dosePart}.`;
  return instruction !== '' ? instruction : null;
}

/** "Lô A123 · HSD 06/2028" — nhiều lô thì nối bằng "; ". Không lô nào thì `null`. */
export function formatLabelLots(batches: MedicineLabelItem['batches']): string | null {
  if (batches.length === 0) return null;
  return batches
    .map((b) => {
      const expiry = b.expiryDate ? `${b.expiryDate.slice(5, 7)}/${b.expiryDate.slice(0, 4)}` : null;
      return `Lô ${b.batchNo}${expiry ? ` · HSD ${expiry}` : ''}`;
    })
    .join('; ');
}
