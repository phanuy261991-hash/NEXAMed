import { describe, expect, it } from 'vitest';
import {
  addPartnerRow,
  buildPartnerPayload,
  partnerMargin,
  removePartnerRow,
  setDefaultPartner,
  setPartnerAmount,
  toPartnerRows,
  validatePartnerRows,
  type PartnerPriceRow,
} from './lab-partner-price-model';

const A = { id: 'a', code: 'DT0001', name: 'Bình Minh' };
const B = { id: 'b', code: 'DT0002', name: 'Nam Việt' };

describe('lab-partner-price-model (#291)', () => {
  it('đối tác đầu tiên tự là mặc định, đối tác sau không; không thêm trùng', () => {
    const one = addPartnerRow([], A);
    expect(one).toEqual([{ supplierId: 'a', code: 'DT0001', name: 'Bình Minh', amount: undefined, isDefault: true }]);
    const two = addPartnerRow(one, B);
    expect(two.map((r) => r.isDefault)).toEqual([true, false]);
    expect(addPartnerRow(two, A)).toBe(two);
  });

  it('xoá đối tác mặc định thì dòng đầu còn lại thành mặc định; xoá hết thì rỗng', () => {
    const rows = addPartnerRow(addPartnerRow([], A), B);
    const afterRemove = removePartnerRow(rows, 'a');
    expect(afterRemove).toHaveLength(1);
    expect(afterRemove[0]).toMatchObject({ supplierId: 'b', isDefault: true });
    expect(removePartnerRow(afterRemove, 'b')).toEqual([]);
  });

  it('đặt mặc định chuyển dấu sang đúng một dòng; id lạ không đổi gì', () => {
    const rows = addPartnerRow(addPartnerRow([], A), B);
    const next = setDefaultPartner(rows, 'b');
    expect(next.map((r) => r.isDefault)).toEqual([false, true]);
    expect(setDefaultPartner(rows, 'zzz')).toBe(rows);
  });

  it('nhập giá chỉ đổi đúng dòng', () => {
    const rows = addPartnerRow(addPartnerRow([], A), B);
    const next = setPartnerAmount(rows, 'b', 135000);
    expect(next.map((r) => r.amount)).toEqual([undefined, 135000]);
  });

  it('kiểm tra: bật gửi đối tác mà chưa có dòng, hoặc còn dòng chưa nhập giá', () => {
    expect(validatePartnerRows(true, [])).toBe('Chọn ít nhất một đối tác và nhập giá trả.');
    expect(validatePartnerRows(false, [])).toBeNull();
    const rows = addPartnerRow([], A);
    expect(validatePartnerRows(true, rows)).toBe('Nhập giá trả cho mọi đối tác đã chọn.');
    expect(validatePartnerRows(false, rows)).toBe('Nhập giá trả cho mọi đối tác đã chọn.');
    expect(validatePartnerRows(true, setPartnerAmount(rows, 'a', 0))).toBeNull();
  });

  it('dữ liệu gửi máy chủ giữ giá và đối tác mặc định; giá 0 hợp lệ', () => {
    const rows: PartnerPriceRow[] = [
      { supplierId: 'a', code: 'DT0001', name: 'Bình Minh', amount: 150000, isDefault: true },
      { supplierId: 'b', code: 'DT0002', name: 'Nam Việt', amount: 0, isDefault: false },
    ];
    expect(buildPartnerPayload(rows)).toEqual([
      { supplierId: 'a', amount: 150000, isDefault: true },
      { supplierId: 'b', amount: 0, isDefault: false },
    ]);
  });

  it('đọc từ chi tiết dịch vụ; lãi gộp = giá bán trừ giá trả, thiếu số thì null', () => {
    expect(
      toPartnerRows([{ id: 'x', supplierId: 'a', supplierCode: 'DT0001', supplierName: 'Bình Minh', amount: 150000, isDefault: true }]),
    ).toEqual([{ supplierId: 'a', code: 'DT0001', name: 'Bình Minh', amount: 150000, isDefault: true }]);
    expect(toPartnerRows(undefined)).toEqual([]);
    expect(partnerMargin(220000, 150000)).toBe(70000);
    expect(partnerMargin(100000, 135000)).toBe(-35000);
    expect(partnerMargin(undefined, 1)).toBeNull();
    expect(partnerMargin(1, undefined)).toBeNull();
  });
});
