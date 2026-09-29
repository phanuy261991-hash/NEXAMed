/**
 * Bản sao THUẦN CLIENT của `computePrescriptionQuantity`/`formatDoseSummary`
 * (`packages/shared/src/prescription.ts`) — khai lại tại đây thay vì import từ `@nexamed/shared` vì
 * Rollup không dò được 2 export hàm thuần này qua `__exportStar` lúc `vite build` (dù `tsc`/Node
 * thấy đúng), cùng lỗi bundler đã gặp nhiều lần trong dự án (docs/DECISIONS.md #032/#091/#114). Số
 * lượng THẬT lúc lưu luôn do backend tính lại — 2 hàm này chỉ dùng để xem trước/hiển thị ở web.
 * Sửa logic ở bản gốc thì PHẢI sửa lại y hệt ở đây.
 */
export interface PrescriptionDosePeriodsPreview {
  doseMorning: number;
  doseNoon: number;
  doseAfternoon: number;
  doseEvening: number;
}

export function computePrescriptionQuantityPreview(periods: PrescriptionDosePeriodsPreview, durationDays: number): number {
  return (periods.doseMorning + periods.doseNoon + periods.doseAfternoon + periods.doseEvening) * durationDays;
}

export function formatDoseSummaryPreview(periods: PrescriptionDosePeriodsPreview): string {
  const parts: string[] = [];
  if (periods.doseMorning > 0) parts.push(`Sáng ${periods.doseMorning}`);
  if (periods.doseNoon > 0) parts.push(`Trưa ${periods.doseNoon}`);
  if (periods.doseAfternoon > 0) parts.push(`Chiều ${periods.doseAfternoon}`);
  if (periods.doseEvening > 0) parts.push(`Tối ${periods.doseEvening}`);
  return parts.length > 0 ? parts.join(' - ') : '—';
}
