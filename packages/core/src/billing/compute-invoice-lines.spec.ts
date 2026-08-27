import { describe, expect, it } from 'vitest';
import { computeInvoiceFromServiceItems, type ServiceItemForInvoice } from './compute-invoice-lines';

describe('computeInvoiceFromServiceItems (BIL-01)', () => {
  it('cộng đúng tổng từ nhiều dòng có giá', () => {
    const items: ServiceItemForInvoice[] = [
      { id: 'a', examTypeCode: 'EX-001', examTypeName: 'Khám Nội', priceTypeCode: 'PT_NORMAL', unitCode: 'UN_LAN', unitPrice: 150_000, quantity: 1 },
      { id: 'b', examTypeCode: 'EX-014', examTypeName: 'Siêu âm ổ bụng', priceTypeCode: 'PT_NORMAL', unitCode: 'UN_LAN', unitPrice: 300_000, quantity: 1 },
    ];
    const result = computeInvoiceFromServiceItems(items);
    expect(result.totalAmount).toBe(450_000);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toEqual({
      sourceServiceItemId: 'a',
      examTypeCode: 'EX-001',
      examTypeName: 'Khám Nội',
      priceTypeCode: 'PT_NORMAL',
      unitCode: 'UN_LAN',
      unitPrice: 150_000,
      quantity: 1,
      lineTotal: 150_000,
    });
  });

  it('nhân đúng số lượng > 1', () => {
    const items: ServiceItemForInvoice[] = [
      { id: 'a', examTypeCode: 'EX-020', examTypeName: 'Xét nghiệm máu', priceTypeCode: null, unitCode: 'UN_MAU', unitPrice: 50_000, quantity: 3 },
    ];
    const result = computeInvoiceFromServiceItems(items);
    expect(result.totalAmount).toBe(150_000);
    expect(result.lines[0]!.lineTotal).toBe(150_000);
  });

  it('bỏ qua dòng chưa cấu hình đơn giá (unitPrice=null), không lỗi', () => {
    const items: ServiceItemForInvoice[] = [
      { id: 'a', examTypeCode: 'EX-001', examTypeName: 'Khám Nội', priceTypeCode: 'PT_NORMAL', unitCode: 'UN_LAN', unitPrice: 150_000, quantity: 1 },
      { id: 'b', examTypeCode: 'EX-099', examTypeName: 'Dịch vụ chưa cấu hình giá', priceTypeCode: null, unitCode: null, unitPrice: null, quantity: 1 },
    ];
    const result = computeInvoiceFromServiceItems(items);
    expect(result.totalAmount).toBe(150_000);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.sourceServiceItemId).toBe('a');
  });

  it('không có dòng nào có giá → tổng 0, danh sách rỗng', () => {
    const items: ServiceItemForInvoice[] = [
      { id: 'a', examTypeCode: 'EX-099', examTypeName: 'Chưa có giá', priceTypeCode: null, unitCode: null, unitPrice: null, quantity: 1 },
    ];
    const result = computeInvoiceFromServiceItems(items);
    expect(result.totalAmount).toBe(0);
    expect(result.lines).toHaveLength(0);
  });

  it('mảng rỗng → tổng 0', () => {
    expect(computeInvoiceFromServiceItems([])).toEqual({ lines: [], totalAmount: 0 });
  });
});
