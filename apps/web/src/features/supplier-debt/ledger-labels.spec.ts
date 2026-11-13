import { describe, expect, it } from 'vitest';
import { describeLedgerEntry, ENTRY_TYPE_LABEL } from './ledger-labels';

describe('describeLedgerEntry', () => {
  it('phiếu nhập nhận theo đơn nêu số đơn và đợt nhận', () => {
    expect(describeLedgerEntry({ entryType: 'PURCHASE', purchaseOrderNo: 'DDH2611-0003', purchaseOrderRound: 2 })).toBe('Nhập từ đơn DDH2611-0003 (đợt 2)');
  });

  it('phiếu nhập theo đơn chưa có số đợt thì bỏ phần đợt', () => {
    expect(describeLedgerEntry({ entryType: 'PURCHASE', purchaseOrderNo: 'DDH2611-0003', purchaseOrderRound: null })).toBe('Nhập từ đơn DDH2611-0003');
  });

  it('phiếu nhập lập tay (không đơn) là "Nhập mua hàng"', () => {
    expect(describeLedgerEntry({ entryType: 'PURCHASE', purchaseOrderNo: null, purchaseOrderRound: null })).toBe('Nhập mua hàng');
    expect(describeLedgerEntry({ entryType: 'PURCHASE' })).toBe('Nhập mua hàng');
  });

  it('mọi loại bút toán đều có câu diễn giải khác rỗng', () => {
    for (const entryType of Object.keys(ENTRY_TYPE_LABEL) as (keyof typeof ENTRY_TYPE_LABEL)[]) {
      expect(describeLedgerEntry({ entryType, purchaseOrderNo: null, purchaseOrderRound: null }).length).toBeGreaterThan(0);
    }
  });
});
