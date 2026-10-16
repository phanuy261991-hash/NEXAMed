import { describe, expect, it } from 'vitest';
import {
  amendPrescriptionRequestSchema,
  computePrescriptionExactQuarters,
  computePrescriptionQuantity,
  doseQuarterSchema,
  formatDoseAmount,
  formatDoseSummary,
  hasAnyDose,
  hasFractionalDose,
  savePrescriptionItemsRequestSchema,
} from './prescription';

describe('computePrescriptionQuantity', () => {
  it('tổng 4 buổi × số ngày', () => {
    expect(computePrescriptionQuantity({ doseMorning: 1, doseNoon: 0, doseAfternoon: 1, doseEvening: 1 }, 5)).toBe(15);
  });

  it('chỉ 1 buổi có liều — vẫn tính đúng', () => {
    expect(computePrescriptionQuantity({ doseMorning: 2, doseNoon: 0, doseAfternoon: 0, doseEvening: 0 }, 10)).toBe(20);
  });

  it('cả 4 buổi = 0 → tổng = 0 (dữ liệu cũ trước #196, đã gộp nội dung gốc vào instruction lúc migrate)', () => {
    expect(computePrescriptionQuantity({ doseMorning: 0, doseNoon: 0, doseAfternoon: 0, doseEvening: 0 }, 5)).toBe(0);
  });
});

describe('formatDoseSummary', () => {
  it('bỏ buổi = 0, nối các buổi có liều bằng " - "', () => {
    expect(formatDoseSummary({ doseMorning: 1, doseNoon: 0, doseAfternoon: 1, doseEvening: 1 })).toBe('Sáng 1 - Chiều 1 - Tối 1');
  });

  it('chỉ 1 buổi', () => {
    expect(formatDoseSummary({ doseMorning: 0, doseNoon: 2, doseAfternoon: 0, doseEvening: 0 })).toBe('Trưa 2');
  });

  it('cả 4 buổi = 0 → "—"', () => {
    expect(formatDoseSummary({ doseMorning: 0, doseNoon: 0, doseAfternoon: 0, doseEvening: 0 })).toBe('—');
  });
});

describe('liều lẻ (#241)', () => {
  const P = (m: number, n: number, a: number, e: number) => ({ doseMorning: m, doseNoon: n, doseAfternoon: a, doseEvening: e });

  it('½ viên × 2 lần × 5 ngày = 5 viên', () => {
    expect(computePrescriptionQuantity(P(0.5, 0, 0, 0.5), 5)).toBe(5);
  });

  it('tổng lẻ thì LÀM TRÒN LÊN: ½ × 1 lần × 7 ngày = 3,5 → 4 viên', () => {
    expect(computePrescriptionQuantity(P(0.5, 0, 0, 0), 7)).toBe(4);
    expect(computePrescriptionExactQuarters(P(0.5, 0, 0, 0), 7)).toBe(14);
  });

  it('¼ viên: ¼ × 3 lần × 5 ngày = 3,75 → 4; đúng 4 viên khi chia hết', () => {
    expect(computePrescriptionQuantity(P(0.25, 0.25, 0.25, 0), 5)).toBe(4);
    expect(computePrescriptionQuantity(P(0.25, 0.25, 0.25, 0.25), 4)).toBe(4);
  });

  it('không sai số số thực: 0,75 × 3 buổi × 3 ngày = 6,75 → 7', () => {
    expect(computePrescriptionQuantity(P(0.75, 0.75, 0.75, 0), 3)).toBe(7);
  });

  it('doseQuarterSchema chỉ nhận bội của ¼ trong 0..99,75', () => {
    expect(doseQuarterSchema.safeParse(0.25).success).toBe(true);
    expect(doseQuarterSchema.safeParse(1.5).success).toBe(true);
    expect(doseQuarterSchema.safeParse(0.3).success).toBe(false);
    expect(doseQuarterSchema.safeParse(-0.5).success).toBe(false);
    expect(doseQuarterSchema.safeParse(100).success).toBe(false);
  });

  it('formatDoseAmount hiện phân số: 0,5 → ½, 1,5 → 1½, 2 → 2, 0,25 → ¼, 0 → 0', () => {
    expect([0.5, 1.5, 2, 0.25, 0.75, 2.25, 0].map(formatDoseAmount)).toEqual(['½', '1½', '2', '¼', '¾', '2¼', '0']);
  });

  it('formatDoseSummary dùng phân số', () => {
    expect(formatDoseSummary(P(0.5, 0, 0, 1.5))).toBe('Sáng ½ - Tối 1½');
  });

  it('hasFractionalDose / hasAnyDose', () => {
    expect(hasFractionalDose(P(1, 0, 0, 1))).toBe(false);
    expect(hasFractionalDose(P(1, 0, 0, 0.5))).toBe(true);
    expect(hasAnyDose(P(0, 0, 0, 0))).toBe(false);
    expect(hasAnyDose(P(0, 0, 0, 0.25))).toBe(true);
  });

  it('lưu nháp cho phép dòng chưa có liều; đính chính thì bắt buộc có liều', () => {
    const draftItem = { drugId: '0190c1e0-0000-7000-8000-000000000001', ...P(0, 0, 0, 0), durationDays: 5 };
    expect(savePrescriptionItemsRequestSchema.safeParse({ items: [draftItem] }).success).toBe(true);
    expect(amendPrescriptionRequestSchema.safeParse({ items: [draftItem], amendmentReason: 'x', version: 1 }).success).toBe(false);
    expect(amendPrescriptionRequestSchema.safeParse({ items: [{ ...draftItem, doseMorning: 0.5 }], amendmentReason: 'x', version: 1 }).success).toBe(true);
  });
});
