import { describe, expect, it } from 'vitest';
import type { ClinicalOrderItemView } from '@nexamed/shared';
import { resultStatusOf, selectItemsWithProgress } from './clinical-order-results';

function item(over: Partial<ClinicalOrderItemView>): ClinicalOrderItemView {
  return {
    id: 'i', itemKind: 'TECHNICAL_SERVICE', technicalServiceId: null, examTypeCode: null, code: 'XN1', name: 'Dịch vụ', performance: 'IN_HOUSE', quantity: 1, unitPrice: 1000, lineTotal: 1000,
    packageId: null, placeName: null, serviceKind: 'LAB', note: null, status: 'ORDERED', resultReturnedAt: null, amendmentPending: false, editable: true, ...over,
  };
}

describe('resultStatusOf (khối "Kết quả đã có của lượt khám này")', () => {
  it('đã duyệt còn hiệu lực → "Đã có kết quả" (xanh)', () => {
    expect(resultStatusOf({ amendmentPending: false, resultReturnedAt: '2026-10-06T02:12:00.000Z' })).toEqual({ label: 'Đã có kết quả', tone: 'success' });
  });
  it('đang nhập/chờ duyệt → "Đang thực hiện" (hổ phách)', () => {
    expect(resultStatusOf({ amendmentPending: false, resultReturnedAt: null })).toEqual({ label: 'Đang thực hiện', tone: 'warning' });
  });
  it('đang đính chính thắng mọi trạng thái khác (kết quả cũ tạm không dùng được)', () => {
    expect(resultStatusOf({ amendmentPending: true, resultReturnedAt: null }).label).toBe('Đang đính chính');
    expect(resultStatusOf({ amendmentPending: true, resultReturnedAt: '2026-10-06T02:12:00.000Z' }).label).toBe('Đang đính chính');
  });
});

describe('selectItemsWithProgress', () => {
  it('chỉ lấy dòng làm tại phòng khám đã vào thực hiện; bỏ dòng mới chỉ định, dòng ra ngoài và dòng đã huỷ', () => {
    const items = [
      item({ id: 'ordered', status: 'ORDERED' }),
      item({ id: 'progress', status: 'IN_PROGRESS' }),
      item({ id: 'resulted', status: 'RESULTED' }),
      item({ id: 'done', status: 'COMPLETED', resultReturnedAt: '2026-10-06T02:12:00.000Z' }),
      item({ id: 'amend', status: 'IN_PROGRESS', amendmentPending: true }),
      item({ id: 'external', performance: 'EXTERNAL', status: 'ORDERED', unitPrice: null }),
      item({ id: 'cancelled', status: 'CANCELLED' }),
    ];
    expect(selectItemsWithProgress(items).map((i) => i.id)).toEqual(['progress', 'resulted', 'done', 'amend']);
  });
  it('không có dòng nào thì rỗng (khối không hiện)', () => {
    expect(selectItemsWithProgress([])).toEqual([]);
  });
});
