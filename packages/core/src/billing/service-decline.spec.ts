import { describe, expect, it } from 'vitest';
import {
  computeDeclineAmount,
  computePackageRepriceDelta,
  evaluateDeclinableItem,
  evaluateDeclinableItems,
  remainingLineAmount,
  type DeclinableOrderItem,
  type DeclineOrderItemStatus,
} from './service-decline';

function item(over: Partial<DeclinableOrderItem> = {}): DeclinableOrderItem {
  return {
    orderItemId: 'i1',
    status: 'ORDERED',
    packageId: null,
    invoiceLineId: 'l1',
    lineNet: 300_000,
    refundedAmount: 0,
    ...over,
  };
}

describe('evaluateDeclinableItem', () => {
  it('dịch vụ lẻ còn chờ làm và chưa thu thì bỏ được', () => {
    expect(evaluateDeclinableItem(item(), 'BLOCK')).toEqual({ declinable: true });
  });

  it('đã lấy mẫu / đang làm / có kết quả / đã xong đều bị chặn vì việc đã làm', () => {
    const started: DeclineOrderItemStatus[] = ['IN_PROGRESS', 'RESULTED', 'COMPLETED'];
    for (const status of started) {
      expect(evaluateDeclinableItem(item({ status }), 'REPRICE_SINGLE')).toEqual({
        declinable: false,
        reason: 'WORK_STARTED',
      });
    }
  });

  it('dòng đã huỷ trước đó không huỷ lại — lý do ALREADY_CANCELLED, không phải WORK_STARTED', () => {
    expect(evaluateDeclinableItem(item({ status: 'CANCELLED' }), 'BLOCK')).toEqual({
      declinable: false,
      reason: 'ALREADY_CANCELLED',
    });
  });

  it('chỉ định ra ngoài (không có dòng hoá đơn) thì quầy không xử lý', () => {
    expect(evaluateDeclinableItem(item({ invoiceLineId: null, lineNet: 0 }), 'KEEP_PACKAGE_PRICE')).toEqual({
      declinable: false,
      reason: 'NOT_BILLED_HERE',
    });
  });

  it('đã hoàn đủ tiền của dòng thì không hoàn tiếp', () => {
    expect(evaluateDeclinableItem(item({ refundedAmount: 300_000 }), 'BLOCK')).toEqual({
      declinable: false,
      reason: 'ALREADY_REFUNDED',
    });
  });

  it('hoàn một phần thì VẪN bỏ được phần còn lại', () => {
    expect(evaluateDeclinableItem(item({ refundedAmount: 100_000 }), 'BLOCK')).toEqual({ declinable: true });
  });

  it('dòng không tính tiền nhưng có dòng hoá đơn 0 đồng thì không bị coi là đã hoàn', () => {
    expect(evaluateDeclinableItem(item({ lineNet: 0, refundedAmount: 0 }), 'BLOCK')).toEqual({ declinable: true });
  });

  it('dịch vụ trong gói bị chặn ở chế độ BLOCK, mở ở hai chế độ còn lại', () => {
    const inPackage = item({ packageId: 'p1' });
    expect(evaluateDeclinableItem(inPackage, 'BLOCK')).toEqual({ declinable: false, reason: 'PACKAGE_ITEM_BLOCKED' });
    expect(evaluateDeclinableItem(inPackage, 'REPRICE_SINGLE')).toEqual({ declinable: true });
    expect(evaluateDeclinableItem(inPackage, 'KEEP_PACKAGE_PRICE')).toEqual({ declinable: true });
  });

  it('tính lại theo giá lẻ mà phiếu ĐÃ THU thì chặn (có thể đòi thu thêm); chưa thu thì cho', () => {
    const inPackage = item({ packageId: 'p1' });
    expect(evaluateDeclinableItem(inPackage, 'REPRICE_SINGLE', true)).toEqual({ declinable: false, reason: 'PACKAGE_REPRICE_PAID' });
    expect(evaluateDeclinableItem(inPackage, 'REPRICE_SINGLE', false)).toEqual({ declinable: true });
  });

  it('giữ nguyên giá gói thì phiếu đã thu vẫn bỏ được (tiền không đổi)', () => {
    expect(evaluateDeclinableItem(item({ packageId: 'p1' }), 'KEEP_PACKAGE_PRICE', true)).toEqual({ declinable: true });
  });

  it('phiếu đã thu KHÔNG chặn dịch vụ lẻ (đi nhánh hoàn tiền)', () => {
    expect(evaluateDeclinableItem(item({ packageId: null }), 'REPRICE_SINGLE', true)).toEqual({ declinable: true });
  });

  it('công tắc gói KHÔNG ảnh hưởng dịch vụ lẻ', () => {
    expect(evaluateDeclinableItem(item({ packageId: null }), 'BLOCK')).toEqual({ declinable: true });
  });

  it('dòng vừa đã lấy mẫu vừa thuộc gói bị chặn: lý do là WORK_STARTED (kiểm trước)', () => {
    expect(evaluateDeclinableItem(item({ status: 'IN_PROGRESS', packageId: 'p1' }), 'BLOCK')).toEqual({
      declinable: false,
      reason: 'WORK_STARTED',
    });
  });
});

describe('evaluateDeclinableItems', () => {
  it('giữ nguyên thứ tự và gắn verdict cho từng dòng', () => {
    const rows = evaluateDeclinableItems(
      [item({ orderItemId: 'a' }), item({ orderItemId: 'b', status: 'COMPLETED' })],
      'BLOCK',
    );
    expect(rows.map((r) => r.item.orderItemId)).toEqual(['a', 'b']);
    expect(rows[0]?.verdict).toEqual({ declinable: true });
    expect(rows[1]?.verdict).toEqual({ declinable: false, reason: 'WORK_STARTED' });
  });
});

describe('remainingLineAmount', () => {
  it('trừ phần đã hoàn', () => {
    expect(remainingLineAmount({ lineNet: 300_000, refundedAmount: 100_000 })).toBe(200_000);
  });

  it('không bao giờ âm dù dữ liệu hoàn vượt quá dòng', () => {
    expect(remainingLineAmount({ lineNet: 100_000, refundedAmount: 150_000 })).toBe(0);
  });
});

describe('computeDeclineAmount', () => {
  it('cộng phần còn lại của nhiều dòng', () => {
    expect(
      computeDeclineAmount([
        { lineNet: 300_000, refundedAmount: 0 },
        { lineNet: 180_000, refundedAmount: 0 },
      ]),
    ).toBe(480_000);
  });

  it('mảng rỗng là 0 — dùng cho chế độ giữ nguyên giá gói (tiền không đổi)', () => {
    expect(computeDeclineAmount([])).toBe(0);
  });

  it('cộng đúng với số tiền rất lớn (vượt 2^53 nếu nhân bằng number)', () => {
    const big = 9_007_199_254_740_000;
    expect(computeDeclineAmount([{ lineNet: big, refundedAmount: 0 }])).toBe(big);
  });
});

describe('computePackageRepriceDelta', () => {
  it('bỏ một mục trong gói mà tổng giá lẻ còn lại THẤP hơn giá gói thì phiếu giảm', () => {
    expect(computePackageRepriceDelta({ packageLineNet: 1_000_000, keptListPrices: [400_000, 300_000] })).toEqual({
      repricedTotal: 700_000,
      decrease: 300_000,
      surcharge: 0,
    });
  });

  it('mất chiết khấu gói làm khách phải TRẢ THÊM — trả surcharge, không trả số âm', () => {
    expect(computePackageRepriceDelta({ packageLineNet: 1_000_000, keptListPrices: [700_000, 600_000] })).toEqual({
      repricedTotal: 1_300_000,
      decrease: 0,
      surcharge: 300_000,
    });
  });

  it('bỏ hết mục trong gói thì giảm trọn giá gói', () => {
    expect(computePackageRepriceDelta({ packageLineNet: 1_000_000, keptListPrices: [] })).toEqual({
      repricedTotal: 0,
      decrease: 1_000_000,
      surcharge: 0,
    });
  });

  it('tổng giá lẻ bằng đúng giá gói thì không giảm không thêm', () => {
    expect(computePackageRepriceDelta({ packageLineNet: 900_000, keptListPrices: [500_000, 400_000] })).toEqual({
      repricedTotal: 900_000,
      decrease: 0,
      surcharge: 0,
    });
  });
});
