import { describe, expect, it } from 'vitest';
import {
  applyPriceListLine,
  computePriceListStatus,
  computeServicePackagePrice,
  resolveDrugBaseUnitPrice,
  resolveEffectivePrice,
  roundHalfUpDiv,
  type PriceListLineCandidate,
} from './resolve-effective-price';

function line(partial: Partial<PriceListLineCandidate> & Pick<PriceListLineCandidate, 'priceListId' | 'priority' | 'mode' | 'value'>): PriceListLineCandidate {
  return {
    priceListName: partial.priceListId,
    effectiveFrom: '2027-02-01',
    createdAtMs: 1,
    priceTypeCode: null,
    unitCode: null,
    ...partial,
  };
}

describe('roundHalfUpDiv', () => {
  it('làm tròn nửa lên về 1 đồng', () => {
    expect(roundHalfUpDiv(15, 10)).toBe(2); // 1.5 → 2
    expect(roundHalfUpDiv(14, 10)).toBe(1);
    expect(roundHalfUpDiv(25, 10)).toBe(3); // 2.5 → 3 (không phải làm tròn chẵn)
    expect(roundHalfUpDiv(0, 7)).toBe(0);
  });
});

describe('applyPriceListLine', () => {
  it('giảm % trên giá mặc định', () => {
    expect(applyPriceListLine(150_000, { mode: 'PERCENT_OFF', value: 20 })).toBe(120_000);
    expect(applyPriceListLine(2_000, { mode: 'PERCENT_OFF', value: 10 })).toBe(1_800);
  });
  it('làm tròn nửa lên ở bước cuối', () => {
    // 3.500 × 90% = 3.150; 1.001 × 85% = 850,85 → 851
    expect(applyPriceListLine(3_500, { mode: 'PERCENT_OFF', value: 10 })).toBe(3_150);
    expect(applyPriceListLine(1_001, { mode: 'PERCENT_OFF', value: 15 })).toBe(851);
  });
  it('giá mới thay thế hoàn toàn, không âm', () => {
    expect(applyPriceListLine(420_000, { mode: 'NEW_PRICE', value: 350_000 })).toBe(350_000);
    expect(applyPriceListLine(100, { mode: 'NEW_PRICE', value: 0 })).toBe(0);
  });
  it('giảm 100% = miễn phí', () => {
    expect(applyPriceListLine(80_000, { mode: 'PERCENT_OFF', value: 100 })).toBe(0);
  });
});

describe('resolveEffectivePrice', () => {
  it('không có bảng giá nào → giá mặc định (Bảng giá chung)', () => {
    expect(resolveEffectivePrice({ baseAmount: 150_000, lines: [] })).toEqual({ amount: 150_000, baseAmount: 150_000, applied: null });
  });

  it('bảng ưu tiên cao thắng bảng ưu tiên thấp (đúng mockup: Tết 100 đè quý 1 là 50)', () => {
    const tet = line({ priceListId: 'tet', priority: 100, mode: 'PERCENT_OFF', value: 20 });
    const quy1 = line({ priceListId: 'quy1', priority: 50, mode: 'NEW_PRICE', value: 140_000 });
    const r = resolveEffectivePrice({ baseAmount: 150_000, lines: [quy1, tet] });
    expect(r.amount).toBe(120_000);
    expect(r.applied?.priceListId).toBe('tet');
  });

  it('hết hạn bảng ưu tiên cao thì quay về bảng thấp hơn (nơi gọi đã lọc bảng hết hạn)', () => {
    const quy1 = line({ priceListId: 'quy1', priority: 50, mode: 'NEW_PRICE', value: 140_000 });
    expect(resolveEffectivePrice({ baseAmount: 150_000, lines: [quy1] }).amount).toBe(140_000);
  });

  it('dòng chỉ áp cho 1 Loại giá thì bỏ qua khi xét Loại giá khác → rơi xuống bảng thấp hơn', () => {
    const high = line({ priceListId: 'high', priority: 100, mode: 'NEW_PRICE', value: 1, priceTypeCode: 'GIA_THUONG' });
    const low = line({ priceListId: 'low', priority: 10, mode: 'PERCENT_OFF', value: 10 });
    const r = resolveEffectivePrice({ baseAmount: 1_000, lines: [high, low], priceTypeCode: 'GIA_DICH_VU' });
    expect(r.applied?.priceListId).toBe('low');
    expect(r.amount).toBe(900);
    const same = resolveEffectivePrice({ baseAmount: 1_000, lines: [high, low], priceTypeCode: 'GIA_THUONG' });
    expect(same.applied?.priceListId).toBe('high');
    expect(same.amount).toBe(1);
  });

  it('cùng ưu tiên: bảng bắt đầu muộn hơn thắng, rồi tạo sau hơn', () => {
    const a = line({ priceListId: 'a', priority: 50, mode: 'NEW_PRICE', value: 1, effectiveFrom: '2027-01-01' });
    const b = line({ priceListId: 'b', priority: 50, mode: 'NEW_PRICE', value: 2, effectiveFrom: '2027-02-01' });
    expect(resolveEffectivePrice({ baseAmount: 10, lines: [a, b] }).applied?.priceListId).toBe('b');
    const c = line({ priceListId: 'c', priority: 50, mode: 'NEW_PRICE', value: 3, effectiveFrom: '2027-02-01', createdAtMs: 9 });
    expect(resolveEffectivePrice({ baseAmount: 10, lines: [b, c] }).applied?.priceListId).toBe('c');
  });

  it('mặt hàng chưa có giá mặc định: NEW_PRICE vẫn áp được, PERCENT_OFF thì không', () => {
    const pct = line({ priceListId: 'pct', priority: 100, mode: 'PERCENT_OFF', value: 20 });
    expect(resolveEffectivePrice({ baseAmount: null, lines: [pct] })).toEqual({ amount: null, baseAmount: null, applied: null });
    const np = line({ priceListId: 'np', priority: 10, mode: 'NEW_PRICE', value: 99_000 });
    expect(resolveEffectivePrice({ baseAmount: null, lines: [pct, np] }).amount).toBe(99_000);
  });
});

describe('resolveDrugBaseUnitPrice', () => {
  const factors = new Map([
    ['VI', 10],
    ['HOP', 100],
  ]);

  it('Giảm % áp mọi bậc, tính trên giá đơn vị cơ sở', () => {
    const pct = line({ priceListId: 'p', priority: 10, mode: 'PERCENT_OFF', value: 10 });
    const r = resolveDrugBaseUnitPrice({ baseAmount: 2_000, lines: [pct], baseUnitCode: 'VIEN', factorByUnitCode: factors });
    expect(r.amount).toBe(1_800);
  });

  it('Giá mới ở bậc Hộp được quy về giá 1 đơn vị cơ sở (giá ÷ hệ số, làm tròn nửa lên)', () => {
    const hop = line({ priceListId: 'h', priority: 10, mode: 'NEW_PRICE', value: 165_000, unitCode: 'HOP' });
    const r = resolveDrugBaseUnitPrice({ baseAmount: 2_000, lines: [hop], baseUnitCode: 'VIEN', factorByUnitCode: factors });
    expect(r.amount).toBe(1_650);
  });

  it('Giá mới ở đúng đơn vị cơ sở áp thẳng', () => {
    const vien = line({ priceListId: 'v', priority: 10, mode: 'NEW_PRICE', value: 1_500, unitCode: 'VIEN' });
    expect(resolveDrugBaseUnitPrice({ baseAmount: 2_000, lines: [vien], baseUnitCode: 'VIEN', factorByUnitCode: factors }).amount).toBe(1_500);
  });

  it('bậc không còn trong chuỗi quy đổi thì bỏ qua dòng đó', () => {
    const stale = line({ priceListId: 's', priority: 99, mode: 'NEW_PRICE', value: 1, unitCode: 'THUNG' });
    const r = resolveDrugBaseUnitPrice({ baseAmount: 2_000, lines: [stale], baseUnitCode: 'VIEN', factorByUnitCode: factors });
    expect(r.applied).toBeNull();
    expect(r.amount).toBe(2_000);
  });

  it('ưu tiên cao thắng dù là Giảm % hay Giá mới', () => {
    const hop = line({ priceListId: 'h', priority: 10, mode: 'NEW_PRICE', value: 165_000, unitCode: 'HOP' });
    const pct = line({ priceListId: 'p', priority: 20, mode: 'PERCENT_OFF', value: 50 });
    expect(resolveDrugBaseUnitPrice({ baseAmount: 2_000, lines: [hop, pct], baseUnitCode: 'VIEN', factorByUnitCode: factors }).amount).toBe(1_000);
  });
});

describe('computeServicePackagePrice', () => {
  const items = [
    { quantity: 1, unitPrice: 150_000 },
    { quantity: 1, unitPrice: 80_000 },
    { quantity: 1, unitPrice: 420_000 },
    { quantity: 1, unitPrice: 350_000 },
    { quantity: 1, unitPrice: 420_000 },
    { quantity: 1, unitPrice: 150_000 },
  ];

  it('giá cố định: khách lợi = tổng lẻ − giá gói (đúng mockup 1.570.000 → 1.200.000, lợi 370.000)', () => {
    const r = computeServicePackagePrice({ mode: 'FIXED', fixedPrice: 1_200_000, discountType: null, discountValue: null, items });
    expect(r.retailTotal).toBe(1_570_000);
    expect(r.price).toBe(1_200_000);
    expect(r.saving).toBe(370_000);
  });

  it('tổng trừ chiết khấu phần trăm', () => {
    const r = computeServicePackagePrice({ mode: 'SUM_MINUS_DISCOUNT', fixedPrice: null, discountType: 'PERCENT', discountValue: 10, items });
    expect(r.price).toBe(1_413_000);
  });

  it('tổng trừ chiết khấu số tiền, không xuống dưới 0', () => {
    const r = computeServicePackagePrice({ mode: 'SUM_MINUS_DISCOUNT', fixedPrice: null, discountType: 'AMOUNT', discountValue: 5_000_000, items });
    expect(r.price).toBe(0);
  });

  it('có số lượng > 1 và dịch vụ con chưa có giá', () => {
    const r = computeServicePackagePrice({
      mode: 'SUM_MINUS_DISCOUNT',
      fixedPrice: null,
      discountType: null,
      discountValue: null,
      items: [
        { quantity: 2, unitPrice: 100_000 },
        { quantity: 1, unitPrice: null },
      ],
    });
    expect(r.retailTotal).toBe(200_000);
    expect(r.unpricedItemCount).toBe(1);
    expect(r.price).toBe(200_000);
  });

  it('FIXED thiếu giá → chưa tính được', () => {
    expect(computeServicePackagePrice({ mode: 'FIXED', fixedPrice: null, discountType: null, discountValue: null, items }).price).toBeNull();
  });
});

describe('computePriceListStatus', () => {
  const list = { isActive: true, effectiveFrom: '2027-02-01', effectiveTo: '2027-02-14' };
  it('phân loại theo ngày, gồm cả hai đầu', () => {
    expect(computePriceListStatus(list, '2027-01-31')).toBe('UPCOMING');
    expect(computePriceListStatus(list, '2027-02-01')).toBe('ACTIVE');
    expect(computePriceListStatus(list, '2027-02-14')).toBe('ACTIVE');
    expect(computePriceListStatus(list, '2027-02-15')).toBe('EXPIRED');
  });
  it('bị ngừng thì luôn STOPPED', () => {
    expect(computePriceListStatus({ ...list, isActive: false }, '2027-02-05')).toBe('STOPPED');
  });
});
