import { describe, expect, it } from 'vitest';
import { pickInitialPriceTypeCode, type DatedExamTypePrice } from './default-price-type';

const TODAY = '2026-10-29';
const price = (priceTypeCode: string, effectiveFrom = '2026-01-01', effectiveTo?: string): DatedExamTypePrice => ({ priceTypeCode, effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}) });

describe('pickInitialPriceTypeCode — Loại giá chọn sẵn ở Tiếp nhận (#268)', () => {
  it('dịch vụ có đơn giá hiệu lực cho mức mặc định → chọn sẵn mức đó (kể cả khi còn mức khác)', () => {
    expect(pickInitialPriceTypeCode('THUONG', [price('VIP'), price('THUONG')], TODAY)).toBe('THUONG');
  });

  it('dịch vụ KHÔNG có giá cho mức mặc định (chỉ khai mức khác) → để trống, không tự nhảy sang mức khác', () => {
    expect(pickInitialPriceTypeCode('THUONG', [price('VIP')], TODAY)).toBe('');
  });

  it('phòng khám chưa đặt mức mặc định → để trống', () => {
    expect(pickInitialPriceTypeCode('', [price('THUONG'), price('VIP')], TODAY)).toBe('');
  });

  it('dịch vụ chưa có dòng giá nào → để trống', () => {
    expect(pickInitialPriceTypeCode('THUONG', [], TODAY)).toBe('');
  });

  it('giá mức mặc định đã hết hạn hoặc chưa tới ngày hiệu lực → để trống', () => {
    expect(pickInitialPriceTypeCode('THUONG', [price('THUONG', '2026-01-01', '2026-10-28')], TODAY)).toBe('');
    expect(pickInitialPriceTypeCode('THUONG', [price('THUONG', '2026-10-30')], TODAY)).toBe('');
  });

  it('biên: hiệu lực đúng ngày hôm nay (từ ngày = hôm nay hoặc đến ngày = hôm nay) vẫn chọn sẵn', () => {
    expect(pickInitialPriceTypeCode('THUONG', [price('THUONG', TODAY)], TODAY)).toBe('THUONG');
    expect(pickInitialPriceTypeCode('THUONG', [price('THUONG', '2026-01-01', TODAY)], TODAY)).toBe('THUONG');
  });

  it('có dòng cũ đã hết hạn VÀ dòng mới đang hiệu lực của cùng mức → chọn sẵn (xét tất cả dòng)', () => {
    expect(pickInitialPriceTypeCode('THUONG', [price('THUONG', '2025-01-01', '2025-12-31'), price('THUONG', '2026-01-01')], TODAY)).toBe('THUONG');
  });
});
