import { describe, expect, it } from 'vitest';
import { formatMarginPercent, marginBarPercent, parsePharmacyTab, PHARMACY_LINK_TABS, PHARMACY_OWN_TABS, truncatedNote } from './pharmacy-model';

describe('tab của trang Thuốc và vật tư', () => {
  it('parse tab: giá trị lạ hoặc rỗng → tab mặc định; ba tab của trang đều nhận ra', () => {
    expect(parsePharmacyTab(null)).toBe('dispensed');
    expect(parsePharmacyTab('khong-co')).toBe('dispensed');
    expect(parsePharmacyTab('stock-ledger')).toBe('dispensed'); // tab kho là liên kết sang trang cũ, không phải tab của trang này
    for (const t of PHARMACY_OWN_TABS) expect(parsePharmacyTab(t.id)).toBe(t.id);
  });

  it('bốn tab kho giữ đúng đường dẫn và quyền của trang cũ, không trùng mã với tab của trang này', () => {
    expect(PHARMACY_LINK_TABS.map((t) => t.label)).toEqual(['Nhập-Xuất-Tồn', 'Tồn kho và hạn dùng', 'Hao hụt điều chuyển', 'Công nợ nhà cung cấp']);
    expect(PHARMACY_LINK_TABS.map((t) => t.to)).toEqual(['/inventory/reports/stock-ledger', '/inventory/balances', '/inventory/reports/stock-ledger?tab=shrinkage', '/suppliers/debts']);
    expect(PHARMACY_LINK_TABS.map((t) => t.permission.join('.'))).toEqual(['stock_receipt.report', 'stock_receipt.read', 'stock_receipt.report', 'supplier_debt.read']);
    const own = new Set<string>(PHARMACY_OWN_TABS.map((t) => t.id));
    for (const t of PHARMACY_LINK_TABS) expect(own.has(t.id)).toBe(false);
  });
});

describe('định dạng', () => {
  it('biên lãi gộp luôn một chữ số thập phân kiểu Việt; không xác định → "—"', () => {
    expect(formatMarginPercent(56)).toBe('56,0%');
    expect(formatMarginPercent(44.9)).toBe('44,9%');
    expect(formatMarginPercent(-3.25)).toBe('-3,3%');
    expect(formatMarginPercent(null)).toBe('—');
  });

  it('thanh biên: mặt hàng cao nhất đầy thanh, tỉ lệ theo mặt hàng cao nhất, âm hoặc không xác định → 0', () => {
    expect(marginBarPercent(60, 60)).toBe(100);
    expect(marginBarPercent(30, 60)).toBe(50);
    expect(marginBarPercent(null, 60)).toBe(0);
    expect(marginBarPercent(-10, 60)).toBe(0);
    expect(marginBarPercent(10, 0)).toBe(0);
  });

  it('ghi chú cắt bớt chỉ hiện "còn N khác" khi danh sách bị cắt', () => {
    expect(truncatedNote(8, 150, 'mặt hàng')).toBe('8 mặt hàng đầu · còn 142 mặt hàng khác');
    expect(truncatedNote(8, 8, 'mặt hàng')).toBe('8 mặt hàng');
    expect(truncatedNote(1000, 1500, 'lượt')).toBe('1.000 lượt đầu · còn 500 lượt khác');
  });
});
