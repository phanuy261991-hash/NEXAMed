import type { EncounterInsurance } from '@nexamed/shared';
import { formatDobDisplay } from '../../shared/format/date';

/** Các chứng từ có dòng "Số thẻ BHYT" (ô tích riêng ở Quản lý mẫu in) — khớp `INSURANCE_PRINT_DOCUMENT_TYPES` của `@nexamed/shared` (web chỉ import được KIỂU). */
export const INSURANCE_PRINT_DOCUMENT_TYPES = ['PRESCRIPTION', 'INVOICE', 'MEDICAL_RECORD'] as const;

/** Mặc định ô tích in BHYT — khớp `DEFAULT_INSURANCE_PRINT_CONFIG` của `@nexamed/shared`: TẮT, ẩn dòng khi tự chi trả. */
export const DEFAULT_INSURANCE_PRINT = { show: false, whenSelfPay: 'hide' } as const;

/**
 * Giá trị dòng "Số thẻ BHYT: …" trên bản in (S2-04, docs/DECISIONS.md #243) — CÙNG câu chữ với bệnh án PDF dựng ở máy chủ
 * (`packages/core/src/medical-record/render-patient-medical-record-html.ts`). `null` = không in dòng này (không có thông tin BHYT, hoặc tự chi trả mà bản mẫu chọn "Ẩn cả dòng").
 */
export function formatInsurancePrintValue(insurance: EncounterInsurance | null | undefined, whenSelfPay: 'hide' | 'selfPay'): string | null {
  if (!insurance) return null;
  if (insurance.selfPay || !insurance.cardNo) return whenSelfPay === 'selfPay' ? 'Tự chi trả' : null;
  const kindText = insurance.kind === 'NEW_12' ? ' (thẻ mới)' : insurance.kind === 'OLD_15' ? ' (thẻ cũ)' : '';
  const parts = [`${insurance.cardNo}${kindText}`];
  if (insurance.validFrom && insurance.validTo) parts.push(`hiệu lực ${formatDobDisplay(insurance.validFrom)} – ${formatDobDisplay(insurance.validTo)}`);
  else if (insurance.validTo) parts.push(`đến ${formatDobDisplay(insurance.validTo)}`);
  else if (insurance.validFrom) parts.push(`từ ${formatDobDisplay(insurance.validFrom)}, chưa rõ hạn`);
  if (insurance.benefitRate !== null) parts.push(`hưởng ${insurance.benefitRate}%`);
  if (insurance.facilityName) parts.push(`nơi ĐK KCB: ${insurance.facilityName}`);
  return parts.join(' · ');
}

/** Thẻ mẫu cho phần xem trước bản mẫu in (không phải dữ liệu thật). */
export const SAMPLE_INSURANCE: EncounterInsurance = {
  selfPay: false,
  reason: null,
  cardNo: '079187001234',
  kind: 'NEW_12',
  validFrom: '2026-01-01',
  validTo: null,
  facilityCode: '79124',
  facilityName: 'Trạm Y tế Phường 14',
  benefitRate: 80,
};
