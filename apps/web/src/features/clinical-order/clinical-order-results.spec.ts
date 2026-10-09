import { describe, expect, it } from 'vitest';
import type { ClinicalOrderItemView } from '@nexamed/shared';
import { resultStatusOf, selectResultItems } from './clinical-order-results';

function item(over: Partial<ClinicalOrderItemView>): ClinicalOrderItemView {
  return {
    id: 'i', itemKind: 'TECHNICAL_SERVICE', technicalServiceId: null, examTypeCode: null, code: 'XN1', name: 'Dịch vụ', performance: 'IN_HOUSE', quantity: 1, unitPrice: 1000, lineTotal: 1000,
    packageId: null, placeName: null, serviceKind: 'LAB', note: null, status: 'ORDERED', resultReturnedAt: null, amendmentPending: false, editable: true, ...over,
  };
}

describe('resultStatusOf (tab "Kết quả cận lâm sàng")', () => {
  it('đã duyệt còn hiệu lực → "Đã có kết quả" (xanh)', () => {
    expect(resultStatusOf({ amendmentPending: false, resultReturnedAt: '2026-10-06T02:12:00.000Z' })).toEqual({ label: 'Đã có kết quả', tone: 'success' });
  });
  it('đang nhập/chờ duyệt → "Đang thực hiện" (hổ phách)', () => {
    expect(resultStatusOf({ amendmentPending: false, resultReturnedAt: null })).toEqual({ label: 'Đang thực hiện', tone: 'warning' });
    expect(resultStatusOf({ amendmentPending: false, resultReturnedAt: null, status: 'IN_PROGRESS' }).label).toBe('Đang thực hiện');
  });
  it('mới chỉ định, chưa vào thực hiện → "Chờ thực hiện" (xám)', () => {
    expect(resultStatusOf({ amendmentPending: false, resultReturnedAt: null, status: 'ORDERED' })).toEqual({ label: 'Chờ thực hiện', tone: 'neutral' });
  });
  it('đang đính chính thắng mọi trạng thái khác (kết quả cũ tạm không dùng được)', () => {
    expect(resultStatusOf({ amendmentPending: true, resultReturnedAt: null }).label).toBe('Đang đính chính');
    expect(resultStatusOf({ amendmentPending: true, resultReturnedAt: '2026-10-06T02:12:00.000Z' }).label).toBe('Đang đính chính');
  });
});

describe('selectResultItems', () => {
  it('lấy mọi dịch vụ kỹ thuật làm tại phòng khám chưa huỷ (kể cả mới chỉ định); bỏ dịch vụ khám, dòng ra ngoài và dòng đã huỷ', () => {
    const items = [
      item({ id: 'ordered', status: 'ORDERED' }),
      item({ id: 'progress', status: 'IN_PROGRESS' }),
      item({ id: 'resulted', status: 'RESULTED' }),
      item({ id: 'done', status: 'COMPLETED', resultReturnedAt: '2026-10-06T02:12:00.000Z' }),
      item({ id: 'amend', status: 'IN_PROGRESS', amendmentPending: true }),
      item({ id: 'external', performance: 'EXTERNAL', status: 'ORDERED', unitPrice: null, serviceKind: null }),
      item({ id: 'exam', itemKind: 'EXAM_TYPE', serviceKind: null, status: 'ORDERED' }),
      item({ id: 'cancelled', status: 'CANCELLED' }),
    ];
    expect(selectResultItems(items).map((i) => i.id)).toEqual(['ordered', 'progress', 'resulted', 'done', 'amend']);
  });
  it('không có dòng nào thì rỗng', () => {
    expect(selectResultItems([])).toEqual([]);
  });
});
