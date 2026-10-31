import type { RecordBundleConfig } from '@nexamed/shared';

/** Mặc định "kèm hết" — khớp `DEFAULT_RECORD_BUNDLE_CONFIG` của `@nexamed/shared` (web chỉ import được KIỂU). Bản mẫu chưa có khối này = kèm hết (docs/DECISIONS.md #272). */
export const DEFAULT_RECORD_BUNDLE: RecordBundleConfig = { includeParaclinical: true, includePrescriptions: true };

/** Chứng từ có khối "Bộ hồ sơ khi in một lượt khám" — khớp `RECORD_BUNDLE_DOCUMENT_TYPES` của `@nexamed/shared`. */
export const RECORD_BUNDLE_DOCUMENT_TYPES: readonly string[] = ['MEDICAL_RECORD'];

/**
 * Dòng mô tả bộ hồ sơ in ra ("Tờ khám theo mẫu + 2 phiếu kết quả + 1 đơn thuốc"): tờ khám luôn có, phiếu kết quả/đơn thuốc chỉ kể khi vừa CÓ thật vừa được bản mẫu bật.
 * Dùng chung cho hộp "In bộ hồ sơ" ở tab Hồ sơ bệnh án và dòng minh hoạ ở Quản lý mẫu in.
 */
export function recordBundleSummary(counts: { paraclinical: number; prescriptions: number }, bundle: RecordBundleConfig = DEFAULT_RECORD_BUNDLE): string {
  const parts = ['Tờ khám theo mẫu'];
  if (bundle.includeParaclinical && counts.paraclinical > 0) parts.push(`${counts.paraclinical} phiếu kết quả`);
  if (bundle.includePrescriptions && counts.prescriptions > 0) parts.push(`${counts.prescriptions} đơn thuốc`);
  return parts.join(' + ');
}
