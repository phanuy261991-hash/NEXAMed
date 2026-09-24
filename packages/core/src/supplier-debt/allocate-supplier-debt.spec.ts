import { describe, expect, it } from 'vitest';
import { allocateSupplierDebt, type SupplierDebtEntryInput } from './allocate-supplier-debt';

function entry(partial: Partial<SupplierDebtEntryInput> & Pick<SupplierDebtEntryInput, 'id' | 'entryType' | 'amountChange'>): SupplierDebtEntryInput {
  return { stockReceiptId: null, reversalOfId: null, ...partial };
}

describe('allocateSupplierDebt', () => {
  it('1 PURCHASE chưa trả gì → UNPAID, dueAmount = originalAmount', () => {
    const result = allocateSupplierDebt([entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 100, stockReceiptId: 'PN1' })]);
    expect(result.items).toEqual([
      { key: 'PN1', entryId: 'e1', entryType: 'PURCHASE', stockReceiptId: 'PN1', originalAmount: 100, paidAmount: 0, dueAmount: 100, status: 'UNPAID' },
    ]);
    expect(result.overpaidCarry).toBe(0);
  });

  it('trả MỘT PHẦN qua FIFO (không chỉ đích) → PARTIALLY_PAID', () => {
    const result = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 100, stockReceiptId: 'PN1' }),
      entry({ id: 'e2', entryType: 'PAYMENT', amountChange: -40, stockReceiptId: null }),
    ]);
    expect(result.items[0]).toMatchObject({ paidAmount: 40, dueAmount: 60, status: 'PARTIALLY_PAID' });
  });

  it('trả ĐỦ đúng số → FULLY_PAID', () => {
    const result = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 100, stockReceiptId: 'PN1' }),
      entry({ id: 'e2', entryType: 'PAYMENT', amountChange: -100 }),
    ]);
    expect(result.items[0]).toMatchObject({ dueAmount: 0, status: 'FULLY_PAID' });
    expect(result.overpaidCarry).toBe(0);
  });

  it('2 khoản nợ, trả FIFO — trả 1 khoản trước, dư sang khoản sau (khoản CŨ nhất trước)', () => {
    const result = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 50, stockReceiptId: 'PN1' }),
      entry({ id: 'e2', entryType: 'PURCHASE', amountChange: 80, stockReceiptId: 'PN2' }),
      entry({ id: 'e3', entryType: 'PAYMENT', amountChange: -60 }),
    ]);
    expect(result.items[0]).toMatchObject({ key: 'PN1', dueAmount: 0, status: 'FULLY_PAID' }); // hết 50
    expect(result.items[1]).toMatchObject({ key: 'PN2', dueAmount: 70, status: 'PARTIALLY_PAID' }); // 80-10
  });

  it('trả CÓ chỉ đích (stockReceiptId) — trừ đúng khoản đích trước, dù không phải khoản cũ nhất', () => {
    const result = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 50, stockReceiptId: 'PN1' }),
      entry({ id: 'e2', entryType: 'PURCHASE', amountChange: 80, stockReceiptId: 'PN2' }),
      // Trả đích PN2 trước (mới hơn PN1) — không FIFO thuần theo thứ tự PURCHASE.
      entry({ id: 'e3', entryType: 'PAYMENT', amountChange: -80, stockReceiptId: 'PN2' }),
    ]);
    expect(result.items[0]).toMatchObject({ key: 'PN1', dueAmount: 50, status: 'UNPAID' });
    expect(result.items[1]).toMatchObject({ key: 'PN2', dueAmount: 0, status: 'FULLY_PAID' });
  });

  it('trả có chỉ đích nhưng VƯỢT khoản đích — phần dư chảy tiếp FIFO sang khoản khác', () => {
    const result = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 30, stockReceiptId: 'PN1' }),
      entry({ id: 'e2', entryType: 'PURCHASE', amountChange: 50, stockReceiptId: 'PN2' }),
      entry({ id: 'e3', entryType: 'RETURN', amountChange: -40, stockReceiptId: 'PN1' }), // PN1 chỉ nợ 30
    ]);
    expect(result.items[0]).toMatchObject({ key: 'PN1', dueAmount: 0, status: 'FULLY_PAID' });
    expect(result.items[1]).toMatchObject({ key: 'PN2', dueAmount: 40, status: 'PARTIALLY_PAID' }); // 50-10
  });

  it('trả DƯ hết mọi khoản nợ hiện có → overpaidCarry (NCC nợ lại), tự cấn trừ vào khoản nợ PHÁT SINH SAU', () => {
    const noNewDebt = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 100, stockReceiptId: 'PN1' }),
      entry({ id: 'e2', entryType: 'PAYMENT', amountChange: -100 }),
      entry({ id: 'e3', entryType: 'RETURN', amountChange: -15, stockReceiptId: 'PN1' }), // PN1 đã hết, dư 15
    ]);
    expect(noNewDebt.items[0]).toMatchObject({ dueAmount: 0, status: 'FULLY_PAID' });
    expect(noNewDebt.overpaidCarry).toBe(15);

    const withNewDebt = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 100, stockReceiptId: 'PN1' }),
      entry({ id: 'e2', entryType: 'PAYMENT', amountChange: -100 }),
      entry({ id: 'e3', entryType: 'RETURN', amountChange: -15, stockReceiptId: 'PN1' }),
      entry({ id: 'e4', entryType: 'PURCHASE', amountChange: 40, stockReceiptId: 'PN2' }), // bị cấn trừ 15 ngay
    ]);
    expect(withNewDebt.overpaidCarry).toBe(0);
    expect(withNewDebt.items[1]).toMatchObject({ key: 'PN2', originalAmount: 40, paidAmount: 15, dueAmount: 25, status: 'PARTIALLY_PAID' });
  });

  it('REFUND_RECEIVED (NCC hoàn tiền) offset đúng overpaidCarry đang có', () => {
    const result = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 100, stockReceiptId: 'PN1' }),
      entry({ id: 'e2', entryType: 'PAYMENT', amountChange: -100 }),
      entry({ id: 'e3', entryType: 'RETURN', amountChange: -20, stockReceiptId: 'PN1' }),
      entry({ id: 'e4', entryType: 'REFUND_RECEIVED', amountChange: 20, stockReceiptId: null }),
    ]);
    expect(result.overpaidCarry).toBe(0);
    expect(result.items[1]).toMatchObject({ entryId: 'e4', entryType: 'REFUND_RECEIVED', originalAmount: 20, dueAmount: 0, status: 'FULLY_PAID' });
  });

  it('huỷ giữa chừng — cặp (gốc + REVERSAL) bị loại khỏi tính toán hoàn toàn', () => {
    const result = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 100, stockReceiptId: 'PN1' }),
      entry({ id: 'e2', entryType: 'PURCHASE', amountChange: 50, stockReceiptId: 'PN2', reversalOfId: null }),
      entry({ id: 'e3', entryType: 'REVERSAL', amountChange: -50, stockReceiptId: 'PN2', reversalOfId: 'e2' }),
    ]);
    // PN2 (e2) và bút toán đảo (e3) biến mất hoàn toàn — chỉ còn PN1.
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ key: 'PN1', dueAmount: 100 });
  });

  it('huỷ 1 khoản PURCHASE đã từng bị trả một phần — trả trước đó vẫn còn hiệu lực trên khoản KHÁC do FIFO xử lý lại từ đầu', () => {
    // Kịch bản thật: PN1 nợ 100, trả 40 (FIFO vào PN1) → huỷ PN1 (đảo cả +100 lẫn phần đã "nằm trong"
    // FIFO của nó) — vì thuật toán tính LẠI TỪ ĐẦU mỗi lần đọc (không lưu trạng thái), loại bỏ đúng
    // cặp PURCHASE/REVERSAL của PN1 nghĩa là khoản trả 40 kia GIỜ không còn gì để trừ vào (PN1 không
    // tồn tại nữa) — chảy tiếp FIFO/overpaidCarry đúng vai trò ban đầu của nó.
    const result = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'PURCHASE', amountChange: 100, stockReceiptId: 'PN1' }),
      entry({ id: 'e2', entryType: 'PAYMENT', amountChange: -40 }),
      entry({ id: 'e3', entryType: 'REVERSAL', amountChange: -100, stockReceiptId: 'PN1', reversalOfId: 'e1' }),
    ]);
    expect(result.items).toHaveLength(0);
    expect(result.overpaidCarry).toBe(40);
  });

  it('OPENING_BALANCE đứng đầu sổ, FIFO trả vào nó trước (đúng vai trò "khoản nợ cũ nhất")', () => {
    const result = allocateSupplierDebt([
      entry({ id: 'e1', entryType: 'OPENING_BALANCE', amountChange: 30, stockReceiptId: null }),
      entry({ id: 'e2', entryType: 'PURCHASE', amountChange: 70, stockReceiptId: 'PN1' }),
      entry({ id: 'e3', entryType: 'PAYMENT', amountChange: -30 }),
    ]);
    expect(result.items[0]).toMatchObject({ entryType: 'OPENING_BALANCE', dueAmount: 0, status: 'FULLY_PAID' });
    expect(result.items[1]).toMatchObject({ key: 'PN1', dueAmount: 70, status: 'UNPAID' });
  });

  it('khớp đúng số liệu mẫu mockup "Minh Châu": nợ đầu 12.500.000 + 4 phiếu, 1 huỷ, còn nợ 28.340.000', () => {
    const result = allocateSupplierDebt([
      entry({ id: 'open', entryType: 'OPENING_BALANCE', amountChange: 12_500_000, stockReceiptId: null }),
      entry({ id: 'pn12', entryType: 'PURCHASE', amountChange: 18_400_000, stockReceiptId: 'PN12' }),
      entry({ id: 'pay-pn12', entryType: 'PAYMENT', amountChange: -5_000_000, stockReceiptId: 'PN12' }), // trả ngay
      entry({ id: 'pn15', entryType: 'PURCHASE', amountChange: 3_200_000, stockReceiptId: 'PN15' }),
      entry({ id: 'void-pn15', entryType: 'REVERSAL', amountChange: -3_200_000, stockReceiptId: 'PN15', reversalOfId: 'pn15' }), // huỷ PN15
      entry({ id: 'pn19', entryType: 'PURCHASE', amountChange: 9_750_000, stockReceiptId: 'PN19' }),
      entry({ id: 'pay-fifo', entryType: 'PAYMENT', amountChange: -20_000_000, stockReceiptId: null }), // thanh toán công nợ, FIFO
      entry({ id: 'pn27', entryType: 'PURCHASE', amountChange: 24_300_000, stockReceiptId: 'PN27' }),
      entry({ id: 'pay-pn27', entryType: 'PAYMENT', amountChange: -10_000_000, stockReceiptId: 'PN27' }), // trả ngay
      entry({ id: 'return-pn19', entryType: 'RETURN', amountChange: -1_260_000, stockReceiptId: 'PN19' }),
      entry({ id: 'adj-pn27', entryType: 'ADJUSTMENT_DECREASE', amountChange: -350_000, stockReceiptId: 'PN27' }),
    ]);

    const totalDue = result.items.reduce((sum, it) => sum + it.dueAmount, 0) - result.overpaidCarry;
    expect(totalDue).toBe(28_340_000);
    expect(result.items.find((it) => it.key === 'PN15')).toBeUndefined(); // đã huỷ, biến mất khỏi kết quả
    expect(result.items.find((it) => it.key === 'open')).toMatchObject({ dueAmount: 0, status: 'FULLY_PAID' });
  });
});
