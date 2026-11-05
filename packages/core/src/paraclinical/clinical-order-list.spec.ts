import { describe, expect, it } from 'vitest';
import { deriveOrderRowPayment, deriveOrderRowProgress, isAbnormalFlag, summarizeLookupResult, countAbnormalLabValues } from './clinical-order-list';

describe('deriveOrderRowProgress', () => {
  it('tất cả chưa bắt đầu → Chờ; có người đang làm → Đang thực hiện; xong hết → Đã có kết quả', () => {
    expect(deriveOrderRowProgress('LAB', ['ORDERED', 'ORDERED'])).toEqual({ state: 'WAITING', done: 0, total: 2 });
    expect(deriveOrderRowProgress('LAB', ['ORDERED', 'IN_PROGRESS'])).toEqual({ state: 'IN_PROGRESS', done: 0, total: 2 });
    expect(deriveOrderRowProgress('LAB', ['COMPLETED', 'RESULTED'])).toEqual({ state: 'IN_PROGRESS', done: 1, total: 2 });
    expect(deriveOrderRowProgress('IMAGING', ['COMPLETED'])).toEqual({ state: 'DONE', done: 1, total: 1 });
  });

  it('xong một phần mà phần còn lại chưa bắt đầu vẫn là Đang thực hiện', () => {
    expect(deriveOrderRowProgress('LAB', ['COMPLETED', 'ORDERED'])).toEqual({ state: 'IN_PROGRESS', done: 1, total: 2 });
  });

  it('dòng đã huỷ không tính; tất cả huỷ → Đã huỷ', () => {
    expect(deriveOrderRowProgress('LAB', ['COMPLETED', 'CANCELLED'])).toEqual({ state: 'DONE', done: 1, total: 1 });
    expect(deriveOrderRowProgress('LAB', ['CANCELLED', 'CANCELLED'])).toEqual({ state: 'CANCELLED', done: 0, total: 0 });
  });

  it('chỉ định ra ngoài không có tiến độ', () => {
    expect(deriveOrderRowProgress('EXTERNAL', ['ORDERED'])).toEqual({ state: 'EXTERNAL', done: 0, total: 1 });
    expect(deriveOrderRowProgress('EXTERNAL', ['CANCELLED'])).toEqual({ state: 'CANCELLED', done: 0, total: 0 });
  });
});

describe('deriveOrderRowPayment', () => {
  const item = (status: 'ORDERED' | 'COMPLETED' | 'CANCELLED', invoiceStatuses: string[]) => ({ status, invoiceStatuses });

  it('mọi dịch vụ có tiền đều đã thu → Đã thu; còn dịch vụ chưa thu hoặc chưa lên hoá đơn → Chưa thu', () => {
    expect(deriveOrderRowPayment('LAB', [item('ORDERED', ['PAID']), item('ORDERED', ['PAID'])])).toBe('PAID');
    expect(deriveOrderRowPayment('LAB', [item('ORDERED', ['PAID']), item('ORDERED', ['UNPAID'])])).toBe('UNPAID');
    expect(deriveOrderRowPayment('LAB', [item('ORDERED', ['PAID']), item('ORDERED', [])])).toBe('UNPAID');
    expect(deriveOrderRowPayment('LAB', [item('ORDERED', [])])).toBe('UNPAID');
  });

  it('hoá đơn đã hoàn tiền → Đã hoàn; chỉ định ra ngoài và phiếu chỉ còn dòng huỷ không thu tiền', () => {
    expect(deriveOrderRowPayment('IMAGING', [item('CANCELLED', ['REFUNDED'])])).toBe('REFUNDED');
    expect(deriveOrderRowPayment('EXTERNAL', [item('ORDERED', [])])).toBe('NOT_CHARGED');
    expect(deriveOrderRowPayment('LAB', [item('CANCELLED', [])])).toBe('NOT_CHARGED');
  });

  it('dòng đã huỷ chưa hoàn không kéo phiếu về Chưa thu', () => {
    expect(deriveOrderRowPayment('LAB', [item('COMPLETED', ['PAID']), item('CANCELLED', ['UNPAID'])])).toBe('PAID');
  });
});

describe('summarizeLookupResult / isAbnormalFlag', () => {
  it('xét nghiệm: có chỉ số bất thường → ABNORMAL; có đánh giá mà không bất thường → NORMAL; không đánh giá được → NONE', () => {
    expect(summarizeLookupResult({ isLab: true, abnormalCount: 2, evaluatedCount: 5, hasConclusion: false })).toBe('ABNORMAL');
    expect(summarizeLookupResult({ isLab: true, abnormalCount: 0, evaluatedCount: 5, hasConclusion: false })).toBe('NORMAL');
    expect(summarizeLookupResult({ isLab: true, abnormalCount: 0, evaluatedCount: 0, hasConclusion: false })).toBe('NONE');
  });

  it('CĐHA/thăm dò: theo có kết luận hay không', () => {
    expect(summarizeLookupResult({ isLab: false, abnormalCount: 0, evaluatedCount: 0, hasConclusion: true })).toBe('HAS_CONCLUSION');
    expect(summarizeLookupResult({ isLab: false, abnormalCount: 0, evaluatedCount: 0, hasConclusion: false })).toBe('NONE');
  });

  it('cờ Cao/Thấp/Bất thường là bất thường; Bình thường và rỗng thì không', () => {
    expect(['LOW', 'HIGH', 'ABNORMAL'].every(isAbnormalFlag)).toBe(true);
    expect(isAbnormalFlag('NORMAL')).toBe(false);
    expect(isAbnormalFlag(null)).toBe(false);
  });
});

describe('countAbnormalLabValues', () => {
  const ref = { sex: 'ANY' as const, ageFromYears: 0, ageToYears: null, lowValue: 4, highValue: 10, lowInclusive: true, highInclusive: true, normalText: null, displayText: null };
  const textRef = { ...ref, lowValue: null, highValue: null, normalText: 'Âm tính' };

  it('đếm cao, thấp, bất thường dạng chữ; bình thường không tính; ô trống bỏ qua; không có tham chiếu thì không đánh giá', () => {
    const r = countAbnormalLabValues([
      { valueType: 'NUMBER', valueText: '12', reference: ref },
      { valueType: 'NUMBER', valueText: '2', reference: ref },
      { valueType: 'NUMBER', valueText: '7', reference: ref },
      { valueType: 'TEXT', valueText: 'Dương tính', reference: textRef },
      { valueType: 'TEXT', valueText: 'âm tính', reference: textRef },
      { valueType: 'NUMBER', valueText: '  ', reference: ref },
      { valueType: 'NUMBER', valueText: null, reference: ref },
      { valueType: 'NUMBER', valueText: '99', reference: null },
    ]);
    expect(r).toEqual({ abnormalCount: 3, evaluatedCount: 5 });
  });

  it('biên của khoảng: bằng đầu mút được tính bình thường khi bao gồm, ngoài khoảng khi không bao gồm', () => {
    expect(countAbnormalLabValues([{ valueType: 'NUMBER', valueText: '4', reference: ref }]).abnormalCount).toBe(0);
    expect(countAbnormalLabValues([{ valueType: 'NUMBER', valueText: '4', reference: { ...ref, lowInclusive: false } }]).abnormalCount).toBe(1);
    expect(countAbnormalLabValues([{ valueType: 'NUMBER', valueText: '10,5', reference: ref }]).abnormalCount).toBe(1);
  });

  it('danh sách rỗng cho 0', () => {
    expect(countAbnormalLabValues([])).toEqual({ abnormalCount: 0, evaluatedCount: 0 });
  });
});
