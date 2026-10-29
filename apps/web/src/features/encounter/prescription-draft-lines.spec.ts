import { describe, expect, it } from 'vitest';
import type { PrescriptionItem } from '@nexamed/shared';
import { appendPreviousPrescriptionItems, itemToDraft, type DraftLine } from './prescription-draft-lines';

const DRUG_A = '00000000-0000-4000-8000-00000000000a';
const DRUG_B = '00000000-0000-4000-8000-00000000000b';
const DRUG_C = '00000000-0000-4000-8000-00000000000c';

/** Dòng đơn đã lưu — mặc định "Theo buổi" 1-0-1-0 trong 5 ngày; mỗi ca ghi đè phần khác biệt. */
function item(overrides: Partial<PrescriptionItem> & Pick<PrescriptionItem, 'id' | 'drugId' | 'drugName'>): PrescriptionItem {
  return {
    freeTextDrugName: null,
    activeIngredient: null,
    doseMorning: 1,
    doseNoon: 0,
    doseAfternoon: 1,
    doseEvening: 0,
    durationDays: 5,
    doseMode: 'SCHEDULED',
    singleDose: null,
    doseUnitName: null,
    dosePerBaseUnit: null,
    quantity: 10,
    isSplittable: true,
    unitCode: 'DV-VIEN',
    instruction: null,
    kind: null,
    documentId: null,
    ...overrides,
  };
}

const scheduled = item({ id: 'item-a', drugId: DRUG_A, drugName: 'Amoxicillin 500mg' });
const asNeeded = item({
  id: 'item-b',
  drugId: DRUG_B,
  drugName: 'Paracetamol 250mg',
  doseMode: 'AS_NEEDED',
  doseMorning: 0,
  doseNoon: 0,
  doseAfternoon: 0,
  doseEvening: 0,
  durationDays: null,
  singleDose: 1.5,
  quantity: 5,
  unitCode: 'DV-GOI',
  instruction: 'Uống 1,5 gói khi sốt cao, tối đa 5 lần / 24 tiếng.',
});
const syrupMl = item({
  id: 'item-c',
  drugId: DRUG_C,
  drugName: 'Siro ho 60ml',
  doseMorning: 5,
  doseNoon: 0,
  doseAfternoon: 0,
  doseEvening: 5,
  durationDays: 5,
  singleDose: null,
  doseUnitName: 'ml',
  dosePerBaseUnit: 60,
  quantity: 1,
  unitCode: 'DV-HOP',
});

let seq = 0;
const nextKey = () => `new-key-${++seq}`;

function draftOf(drugId: string | null, overrides: Partial<DraftLine> = {}): DraftLine {
  return { ...itemToDraft(item({ id: `existing-${drugId}`, drugId, drugName: 'Đã có' })), ...overrides };
}

describe('itemToDraft — mang theo kiểu kê (#267)', () => {
  it('"Theo buổi": giữ 4 buổi và số ngày, không có liều mỗi lần / số lượng nhập tay', () => {
    const draft = itemToDraft(scheduled);
    expect(draft).toMatchObject({ doseMode: 'SCHEDULED', doseMorning: '1', doseNoon: '0', doseAfternoon: '1', doseEvening: '0', durationDays: '5', singleDose: '', quantity: '' });
  });

  it('"Khi cần": giữ liều mỗi lần, số lượng và câu dặn; số ngày null → số ngày mặc định để đổi sang "Theo buổi" được', () => {
    const draft = itemToDraft(asNeeded);
    expect(draft.doseMode).toBe('AS_NEEDED');
    expect(draft.singleDose).toBe('1,5');
    expect(draft.quantity).toBe('5');
    expect(draft.durationDays).toBe('5');
    expect(draft.instruction).toBe('Uống 1,5 gói khi sốt cao, tối đa 5 lần / 24 tiếng.');
    expect(draft.unitCode).toBe('DV-GOI');
  });

  it('liều tính theo ml: giữ 4 buổi (5 ml sáng + 5 ml tối), không đánh dấu "chỉnh riêng"', () => {
    const draft = itemToDraft(syrupMl);
    expect(draft).toMatchObject({ doseMode: 'SCHEDULED', doseMorning: '5', doseEvening: '5', durationDays: '5', daysOwn: false });
  });
});

describe('appendPreviousPrescriptionItems — Sao chép đơn lần khám trước (#196/#267)', () => {
  it('đơn đang trống: nạp cả cụm, giữ kiểu kê từng dòng, mỗi dòng có khoá mới', () => {
    const result = appendPreviousPrescriptionItems([], [scheduled, asNeeded, syrupMl], nextKey);
    expect(result.map((l) => l.doseMode)).toEqual(['SCHEDULED', 'AS_NEEDED', 'SCHEDULED']);
    expect(result.map((l) => l.drugName)).toEqual(['Amoxicillin 500mg', 'Paracetamol 250mg', 'Siro ho 60ml']);
    expect(new Set(result.map((l) => l.key)).size).toBe(3);
    expect(result.every((l) => l.key.startsWith('new-key-'))).toBe(true);
  });

  it('dòng "Khi cần" được sao chép nguyên liều mỗi lần, số lượng và câu dặn', () => {
    const [line] = appendPreviousPrescriptionItems([], [asNeeded], nextKey);
    expect(line).toMatchObject({ doseMode: 'AS_NEEDED', singleDose: '1,5', quantity: '5', instruction: 'Uống 1,5 gói khi sốt cao, tối đa 5 lần / 24 tiếng.', daysOwn: false });
  });

  it('thuốc đã có trong đơn đang kê thì bỏ qua (không trùng), giữ nguyên dòng cũ', () => {
    const existing = draftOf(DRUG_A, { key: 'keep-me', doseMorning: '2' });
    const result = appendPreviousPrescriptionItems([existing], [scheduled, asNeeded], nextKey);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ key: 'keep-me', drugId: DRUG_A, doseMorning: '2' });
    expect(result[1]).toMatchObject({ drugId: DRUG_B, doseMode: 'AS_NEEDED' });
  });

  it('toàn bộ thuốc đã có thì không thêm dòng nào', () => {
    const existing = [draftOf(DRUG_A), draftOf(DRUG_B)];
    expect(appendPreviousPrescriptionItems(existing, [scheduled, asNeeded], nextKey)).toHaveLength(2);
  });

  it('số ngày khác số ngày chung (của thuốc "Theo buổi" đầu tiên) → thành "chỉnh riêng"; dòng đầu và dòng cùng số ngày thì không', () => {
    const sevenDays = item({ id: 'item-7', drugId: DRUG_C, drugName: 'Thuốc 7 ngày', durationDays: 7 });
    const result = appendPreviousPrescriptionItems([], [scheduled, sevenDays], nextKey);
    expect(result.map((l) => l.daysOwn)).toEqual([false, true]);
  });

  it('dòng "Khi cần" không bao giờ là "chỉnh riêng" và không làm chuẩn số ngày chung', () => {
    // "Khi cần" đứng đầu đơn trước: số ngày chung lấy từ thuốc "Theo buổi" đầu tiên (7 ngày), nên dòng đó không bị đánh dấu riêng.
    const sevenDays = item({ id: 'item-7', drugId: DRUG_C, drugName: 'Thuốc 7 ngày', durationDays: 7 });
    const result = appendPreviousPrescriptionItems([], [asNeeded, sevenDays], nextKey);
    expect(result.map((l) => l.daysOwn)).toEqual([false, false]);
  });

  it('đơn đang kê đã có thuốc "Theo buổi" 3 ngày: dòng sao chép 5 ngày thành "chỉnh riêng", dòng "Khi cần" thì không', () => {
    const existing = draftOf(DRUG_C, { durationDays: '3' });
    const result = appendPreviousPrescriptionItems([existing], [scheduled, asNeeded], nextKey);
    expect(result.map((l) => [l.drugId, l.daysOwn])).toEqual([
      [DRUG_C, false],
      [DRUG_A, true],
      [DRUG_B, false],
    ]);
  });

  it('không làm đổi mảng dòng đang soạn truyền vào', () => {
    const existing = [draftOf(DRUG_A)];
    const snapshot = JSON.stringify(existing);
    appendPreviousPrescriptionItems(existing, [asNeeded], nextKey);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});
