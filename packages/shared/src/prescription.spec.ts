import { describe, expect, it } from 'vitest';
import { computePrescriptionQuantity, formatDoseSummary } from './prescription';

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
