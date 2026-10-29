import { describe, expect, it } from 'vitest';
import { buildMedicineLabelInstruction, buildMedicineLabelTitle, formatLabelLots, formatLabelQuantity, padSmallQuantity } from './medicine-label';

const noDose = { doseMorning: 0, doseNoon: 0, doseAfternoon: 0, doseEvening: 0, durationDays: null, instruction: null };

describe('padSmallQuantity / formatLabelQuantity', () => {
  it('dưới 10 viết hai chữ số, từ 10 trở lên giữ nguyên', () => {
    expect(padSmallQuantity(1)).toBe('01');
    expect(padSmallQuantity(5)).toBe('05');
    expect(padSmallQuantity(9)).toBe('09');
    expect(padSmallQuantity(10)).toBe('10');
    expect(padSmallQuantity(12)).toBe('12');
    expect(padSmallQuantity(150)).toBe('150');
  });
  it('kèm đơn vị; thiếu đơn vị thì chỉ có số', () => {
    expect(formatLabelQuantity(5, 'Gói')).toBe('05 Gói');
    expect(formatLabelQuantity(1, 'Hộp')).toBe('01 Hộp');
    expect(formatLabelQuantity(12, 'Viên')).toBe('12 Viên');
    expect(formatLabelQuantity(3, null)).toBe('03');
  });
});

describe('buildMedicineLabelTitle', () => {
  it('thêm hoạt chất + hàm lượng chưa có trong tên', () => {
    expect(buildMedicineLabelTitle({ drugName: 'Zyrtec Sol 60ml', activeIngredient: 'Cetirizin dihydroclorid', concentration: '1mg/ml' })).toBe('Zyrtec Sol 60ml (Cetirizin dihydroclorid 1mg/ml)');
  });
  it('bỏ phần đã nằm trong tên (không phân biệt hoa/thường, khoảng trắng) để khỏi in lặp', () => {
    expect(buildMedicineLabelTitle({ drugName: 'Hapacol 250mg', activeIngredient: 'Paracetamol', concentration: '250 MG' })).toBe('Hapacol 250mg (Paracetamol)');
    expect(buildMedicineLabelTitle({ drugName: 'Paracetamol 500mg', activeIngredient: 'paracetamol', concentration: '500mg' })).toBe('Paracetamol 500mg');
  });
  it('thiếu hoạt chất/hàm lượng thì chỉ có tên', () => {
    expect(buildMedicineLabelTitle({ drugName: 'Siro ho', activeIngredient: null, concentration: null })).toBe('Siro ho');
    expect(buildMedicineLabelTitle({ drugName: '  Siro ho  ', activeIngredient: '', concentration: '  ' })).toBe('Siro ho');
  });
});

describe('buildMedicineLabelInstruction', () => {
  it('có liều theo buổi + số ngày + hướng dẫn', () => {
    expect(buildMedicineLabelInstruction({ ...noDose, doseMorning: 1, doseEvening: 1, durationDays: 5, instruction: 'Uống sau ăn' })).toBe('Sáng 1 - Tối 1, 5 ngày. Uống sau ăn');
  });
  it('liều lẻ ½ hiện đúng ký hiệu', () => {
    expect(buildMedicineLabelInstruction({ ...noDose, doseMorning: 0.5, doseNoon: 0.5, doseEvening: 1.5, durationDays: 3, instruction: null })).toBe('Sáng ½ - Trưa ½ - Tối 1½, 3 ngày.');
  });
  it('chỉ có hướng dẫn (hàng không có liều) → đúng nguyên văn hướng dẫn', () => {
    expect(buildMedicineLabelInstruction({ ...noDose, instruction: '  Uống 1,5 gói khi sốt cao  ' })).toBe('Uống 1,5 gói khi sốt cao');
  });
  it('hàng không theo đơn (không liều, không hướng dẫn) → null', () => {
    expect(buildMedicineLabelInstruction(noDose)).toBeNull();
    expect(buildMedicineLabelInstruction({ ...noDose, instruction: '   ' })).toBeNull();
  });
  it('có liều nhưng không có số ngày → không in "null ngày"', () => {
    expect(buildMedicineLabelInstruction({ ...noDose, doseMorning: 1, durationDays: null })).toBe('Sáng 1.');
  });
});

describe('formatLabelLots', () => {
  it('lô + hạn dùng dạng tháng/năm; nhiều lô nối bằng "; "', () => {
    expect(formatLabelLots([{ batchNo: 'A1', expiryDate: '2028-07-31' }])).toBe('Lô A1 · HSD 07/2028');
    expect(formatLabelLots([{ batchNo: 'A1', expiryDate: '2027-01-01' }, { batchNo: 'B2', expiryDate: null }])).toBe('Lô A1 · HSD 01/2027; Lô B2');
  });
  it('không có lô → null', () => {
    expect(formatLabelLots([])).toBeNull();
  });
});
