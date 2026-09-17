import { describe, expect, it } from 'vitest';
import { selectFefoBatches, sortBatchesByFefo } from './select-fefo-batches';

describe('selectFefoBatches', () => {
  it('đủ 1 lô — phân bổ trọn vẹn từ lô đó', () => {
    const result = selectFefoBatches([{ batchId: 'A', quantityOnHand: 100, expiryDate: '2027-01-01' }], 30);
    expect(result).toEqual([{ batchId: 'A', quantity: 30 }]);
  });

  it('lô hỗn hợp hạn dùng — ưu tiên lô hết hạn SỚM NHẤT trước, tràn sang lô kế tiếp khi lô đầu không đủ', () => {
    const result = selectFefoBatches(
      [
        { batchId: 'FAR', quantityOnHand: 50, expiryDate: '2027-06-01' },
        { batchId: 'NEAR', quantityOnHand: 10, expiryDate: '2026-10-01' },
        { batchId: 'MID', quantityOnHand: 20, expiryDate: '2027-01-01' },
      ],
      25,
    );
    expect(result).toEqual([
      { batchId: 'NEAR', quantity: 10 },
      { batchId: 'MID', quantity: 15 },
    ]);
  });

  it('lô không hạn dùng (vật tư y tế) xếp SAU mọi lô có hạn, dù nhập vào trước', () => {
    const result = selectFefoBatches(
      [
        { batchId: 'NO_EXPIRY', quantityOnHand: 100, expiryDate: null },
        { batchId: 'HAS_EXPIRY', quantityOnHand: 5, expiryDate: '2026-12-01' },
      ],
      8,
    );
    expect(result).toEqual([
      { batchId: 'HAS_EXPIRY', quantity: 5 },
      { batchId: 'NO_EXPIRY', quantity: 3 },
    ]);
  });

  it('tổng tồn không đủ → null, KHÔNG phân bổ một phần', () => {
    const result = selectFefoBatches([{ batchId: 'A', quantityOnHand: 5, expiryDate: '2027-01-01' }], 10);
    expect(result).toBeNull();
  });

  it('bỏ qua lô hết tồn (quantityOnHand=0)', () => {
    const result = selectFefoBatches(
      [
        { batchId: 'EMPTY', quantityOnHand: 0, expiryDate: '2026-10-01' },
        { batchId: 'HAS_STOCK', quantityOnHand: 20, expiryDate: '2027-01-01' },
      ],
      10,
    );
    expect(result).toEqual([{ batchId: 'HAS_STOCK', quantity: 10 }]);
  });

  it('quantityNeeded=0 → mảng rỗng, không phải null', () => {
    expect(selectFefoBatches([{ batchId: 'A', quantityOnHand: 10, expiryDate: '2027-01-01' }], 0)).toEqual([]);
  });
});

describe('sortBatchesByFefo', () => {
  it('sắp tăng dần theo hạn dùng, lô không hạn xếp cuối — không đổi mảng gốc', () => {
    const input = [
      { expiryDate: null, label: 'no-expiry' },
      { expiryDate: '2026-11-01', label: 'later' },
      { expiryDate: '2026-10-01', label: 'sooner' },
    ];
    const result = sortBatchesByFefo(input);
    expect(result.map((r) => r.label)).toEqual(['sooner', 'later', 'no-expiry']);
    expect(input[0]!.label).toBe('no-expiry');
  });
});
