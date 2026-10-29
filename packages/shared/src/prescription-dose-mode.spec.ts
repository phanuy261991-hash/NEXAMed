import { describe, expect, it } from 'vitest';
import {
  amendPrescriptionRequestSchema,
  computePrescriptionQuantity,
  formatPrescriptionDose,
  hasFractionalPrescriptionDose,
  isPrescriptionDoseComplete,
  quartersPerBaseUnit,
  resolvePrescriptionItemDose,
  savePrescriptionItemsRequestSchema,
} from './prescription';

const NO_PERIODS = { doseMorning: 0, doseNoon: 0, doseAfternoon: 0, doseEvening: 0 };
const ML_CONFIG = { doseMode: 'SCHEDULED' as const, doseUnitName: 'ml', dosePerBaseUnit: 60 };

describe('quartersPerBaseUnit / computePrescriptionQuantity với dung tích (#267)', () => {
  it('viên/gói: 4 phần tư = 1 đơn vị; dung dịch 60 ml: 240', () => {
    expect(quartersPerBaseUnit()).toBe(4);
    expect(quartersPerBaseUnit(null)).toBe(4);
    expect(quartersPerBaseUnit(60)).toBe(240);
    expect(quartersPerBaseUnit(2.5)).toBe(10);
  });

  it('Zyrtec: (5+5) ml × 5 ngày = 50 ml → 1 Hộp 60 ml; 60 ml tròn 1; 61,5 ml → 2', () => {
    expect(computePrescriptionQuantity({ doseMorning: 5, doseNoon: 0, doseAfternoon: 0, doseEvening: 5 }, 5, 60)).toBe(1);
    expect(computePrescriptionQuantity({ ...NO_PERIODS, doseMorning: 10 }, 6, 60)).toBe(1);
    expect(computePrescriptionQuantity({ ...NO_PERIODS, doseMorning: 10.25 }, 6, 60)).toBe(2);
  });

  it('không truyền dung tích → hành vi cũ (làm tròn lên theo viên)', () => {
    expect(computePrescriptionQuantity({ ...NO_PERIODS, doseMorning: 0.5, doseEvening: 0.5 }, 3)).toBe(3);
  });
});

describe('resolvePrescriptionItemDose (#267)', () => {
  it('"Khi cần": 4 buổi = 0, không số ngày, số lượng lấy thẳng từ bác sĩ (không tính từ liều)', () => {
    const r = resolvePrescriptionItemDose({ ...NO_PERIODS, doseMorning: 9, doseMode: 'AS_NEEDED', singleDose: 1.5, quantity: 5, durationDays: 7 }, null);
    expect(r).toMatchObject({ doseMode: 'AS_NEEDED', doseMorning: 0, durationDays: null, singleDose: 1.5, quantity: 5, doseUnitName: null, dosePerBaseUnit: null });
  });

  it('bỏ trống doseMode → theo cấu hình thuốc; dòng tự do (không cấu hình) → "Theo buổi"', () => {
    const asNeeded = { doseMode: 'AS_NEEDED' as const, doseUnitName: null, dosePerBaseUnit: null };
    expect(resolvePrescriptionItemDose({ ...NO_PERIODS, singleDose: 1, quantity: 3 }, asNeeded).doseMode).toBe('AS_NEEDED');
    expect(resolvePrescriptionItemDose({ ...NO_PERIODS, doseMorning: 1, durationDays: 2 }, null)).toMatchObject({ doseMode: 'SCHEDULED', quantity: 2 });
  });

  it('thuốc viên/gói đổi được kiểu kê trên dòng đơn', () => {
    const plain = { doseMode: 'SCHEDULED' as const, doseUnitName: null, dosePerBaseUnit: null };
    expect(resolvePrescriptionItemDose({ ...NO_PERIODS, doseMode: 'AS_NEEDED', singleDose: 1, quantity: 3 }, plain).doseMode).toBe('AS_NEEDED');
  });

  it('thuốc có đơn vị liều: kiểu kê cố định theo thuốc, khách gửi gì cũng bị bỏ qua; chụp đơn vị + dung tích', () => {
    const r = resolvePrescriptionItemDose({ ...NO_PERIODS, doseMorning: 5, doseEvening: 5, doseMode: 'AS_NEEDED', singleDose: 5, quantity: 9, durationDays: 5 }, ML_CONFIG);
    expect(r).toMatchObject({ doseMode: 'SCHEDULED', singleDose: null, quantity: 1, doseUnitName: 'ml', dosePerBaseUnit: 60, durationDays: 5 });
  });

  it('"Theo buổi" thiếu số ngày → durationDays null (nơi gọi phải từ chối), số lượng 0', () => {
    const r = resolvePrescriptionItemDose({ ...NO_PERIODS, doseMorning: 1 }, { doseMode: 'SCHEDULED', doseUnitName: null, dosePerBaseUnit: null });
    expect(r).toMatchObject({ durationDays: null, quantity: 0 });
  });
});

describe('isPrescriptionDoseComplete / hasFractionalPrescriptionDose (#267)', () => {
  it('"Khi cần" cần liều mỗi lần VÀ số lượng; "Theo buổi" cần một buổi > 0', () => {
    expect(isPrescriptionDoseComplete({ ...NO_PERIODS, doseMode: 'AS_NEEDED', singleDose: 1, quantity: 5 })).toBe(true);
    expect(isPrescriptionDoseComplete({ ...NO_PERIODS, doseMode: 'AS_NEEDED', singleDose: 1, quantity: 0 })).toBe(false);
    expect(isPrescriptionDoseComplete({ ...NO_PERIODS, doseMode: 'AS_NEEDED', singleDose: null, quantity: 5 })).toBe(false);
    expect(isPrescriptionDoseComplete({ ...NO_PERIODS, doseMorning: 1 })).toBe(true);
    expect(isPrescriptionDoseComplete(NO_PERIODS)).toBe(false);
  });

  it('liều lẻ "bẻ viên": xét liều mỗi lần với "Khi cần"; đơn vị liều ml thì không bao giờ lẻ', () => {
    expect(hasFractionalPrescriptionDose({ ...NO_PERIODS, doseMode: 'AS_NEEDED', singleDose: 1.5 })).toBe(true);
    expect(hasFractionalPrescriptionDose({ ...NO_PERIODS, doseMode: 'AS_NEEDED', singleDose: 2 })).toBe(false);
    expect(hasFractionalPrescriptionDose({ ...NO_PERIODS, doseMorning: 2.5, doseUnitName: 'ml' })).toBe(false);
    expect(hasFractionalPrescriptionDose({ ...NO_PERIODS, doseMorning: 0.5 })).toBe(true);
  });
});

describe('formatPrescriptionDose (#267)', () => {
  it('"Theo buổi" có đơn vị liều: số thập phân + đơn vị', () => {
    expect(formatPrescriptionDose({ doseMorning: 5, doseNoon: 0, doseAfternoon: 0, doseEvening: 5, doseUnitName: 'ml' })).toBe('Sáng 5 ml - Tối 5 ml');
    expect(formatPrescriptionDose({ doseMorning: 2.5, doseNoon: 0, doseAfternoon: 0, doseEvening: 2.5, doseUnitName: 'ml' })).toBe('Sáng 2,5 ml - Tối 2,5 ml');
  });

  it('"Theo buổi" không đơn vị: ký hiệu ½ ¼ như cũ', () => {
    expect(formatPrescriptionDose({ doseMorning: 0.5, doseNoon: 0, doseAfternoon: 0, doseEvening: 1.5 })).toBe('Sáng ½ - Tối 1½');
  });

  it('"Khi cần": liều mỗi lần, có/không đơn vị', () => {
    expect(formatPrescriptionDose({ ...NO_PERIODS, doseMode: 'AS_NEEDED', singleDose: 1.5 })).toBe('Mỗi lần 1,5, khi cần');
    expect(formatPrescriptionDose({ ...NO_PERIODS, doseMode: 'AS_NEEDED', singleDose: 1.5, unitName: 'Gói' })).toBe('Mỗi lần 1,5 gói, khi cần');
    expect(formatPrescriptionDose({ ...NO_PERIODS, doseMode: 'AS_NEEDED', singleDose: 2.5, doseUnitName: 'ml' })).toBe('Mỗi lần 2,5 ml, khi cần');
    expect(formatPrescriptionDose({ ...NO_PERIODS, doseMode: 'AS_NEEDED', singleDose: null })).toBe('Khi cần');
  });
});

describe('schema gửi lên (#267)', () => {
  const drugId = '0190a000-0000-7000-8000-000000000001';

  it('dòng "Khi cần" không cần 4 liều theo buổi lẫn số ngày', () => {
    const parsed = savePrescriptionItemsRequestSchema.safeParse({ items: [{ drugId, doseMode: 'AS_NEEDED', singleDose: 1.5, quantity: 5 }] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.items[0]).toMatchObject({ doseMorning: 0, doseEvening: 0 });
  });

  it('"Theo buổi" tường minh thiếu số ngày bị từ chối; bỏ trống kiểu kê thì để máy chủ quyết', () => {
    expect(savePrescriptionItemsRequestSchema.safeParse({ items: [{ drugId, doseMode: 'SCHEDULED', doseMorning: 1 }] }).success).toBe(false);
    expect(savePrescriptionItemsRequestSchema.safeParse({ items: [{ drugId, doseMorning: 1, durationDays: 3 }] }).success).toBe(true);
  });

  it('số lượng "Khi cần" phải là số nguyên 0..9999, liều mỗi lần là bội ¼', () => {
    const bad = (extra: Record<string, unknown>) => savePrescriptionItemsRequestSchema.safeParse({ items: [{ drugId, doseMode: 'AS_NEEDED', singleDose: 1, quantity: 1, ...extra }] }).success;
    expect(bad({})).toBe(true);
    expect(bad({ quantity: -1 })).toBe(false);
    expect(bad({ quantity: 2.5 })).toBe(false);
    expect(bad({ quantity: 10000 })).toBe(false);
    expect(bad({ singleDose: 0.3 })).toBe(false);
  });

  it('đính chính: "Khi cần" thiếu số lượng hoặc liều mỗi lần bị từ chối', () => {
    const amend = (item: Record<string, unknown>) => amendPrescriptionRequestSchema.safeParse({ items: [{ drugId, doseMode: 'AS_NEEDED', ...item }], amendmentReason: 'x', version: 1 }).success;
    expect(amend({ singleDose: 1, quantity: 5 })).toBe(true);
    expect(amend({ singleDose: 1, quantity: 0 })).toBe(false);
    expect(amend({ quantity: 5 })).toBe(false);
  });
});
