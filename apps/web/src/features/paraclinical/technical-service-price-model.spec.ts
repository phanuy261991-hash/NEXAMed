import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPriceLines,
  chooseManagedPriceType,
  dayBefore,
  hiddenOtherPriceTypeCodes,
  initialPriceFormInput,
  rankPriceTypeCodes,
  splitPriceLines,
  validatePriceForm,
  type PriceFormInput,
  type TechnicalServicePriceLine,
} from './technical-service-price-model';

const TODAY = '2026-10-29';

const line = (priceTypeCode: string, amount: number, effectiveFrom = '2026-01-01', effectiveTo?: string, unitCode = 'LUOT'): TechnicalServicePriceLine => ({
  priceTypeCode,
  unitCode,
  amount,
  effectiveFrom,
  ...(effectiveTo ? { effectiveTo } : {}),
});

const RANKED = rankPriceTypeCodes(['THUONG', 'VIP', 'NGOAIGIO'], '');

describe('dayBefore', () => {
  it.each([
    ['2027-01-01', '2026-12-31'],
    ['2026-03-01', '2026-02-28'],
    ['2028-03-01', '2028-02-29'],
    ['2026-10-29', '2026-10-28'],
  ])('ngày liền trước %s là %s', (date, expected) => {
    expect(dayBefore(date)).toBe(expected);
  });
});

// Bộ ca DÙNG CHUNG với máy chủ (`apps/api/src/modules/pricing/price-type-ranking.spec.ts`): hai bản cài đặt luật xếp mức phải cho kết quả giống hệt.
const sharedRankingCases = (
  JSON.parse(readFileSync(new URL('../../../../../packages/shared/test-vectors/price-type-ranking.json', import.meta.url), 'utf8')) as {
    cases: { name: string; catalog: string[]; defaultCode: string; expected: string[] }[];
  }
).cases;

describe('rankPriceTypeCodes — bộ ca dùng chung với máy chủ', () => {
  it.each(sharedRankingCases)('$name', ({ catalog, defaultCode, expected }) => {
    expect(rankPriceTypeCodes(catalog, defaultCode)).toEqual(expected);
  });
});

describe('rankPriceTypeCodes — mức mặc định đứng đầu (khớp thứ tự máy chủ dùng để tính tiền)', () => {
  it('có mặc định → mặc định đầu tiên, còn lại giữ thứ tự danh mục', () => {
    expect(rankPriceTypeCodes(['THUONG', 'VIP', 'NGOAIGIO'], 'VIP')).toEqual(['VIP', 'THUONG', 'NGOAIGIO']);
  });
  it('chưa có mặc định → giữ nguyên thứ tự danh mục', () => {
    expect(rankPriceTypeCodes(['THUONG', 'VIP'], '')).toEqual(['THUONG', 'VIP']);
  });
});

describe('chooseManagedPriceType', () => {
  it('chỉ một mức → mức đó', () => {
    expect(chooseManagedPriceType([line('THUONG', 150_000)], RANKED, TODAY)).toBe('THUONG');
  });

  it('nhiều mức cùng hiệu lực → mức xếp đầu (mặc định thắng thứ tự danh mục)', () => {
    const lines = [line('THUONG', 150_000), line('VIP', 250_000)];
    expect(chooseManagedPriceType(lines, RANKED, TODAY)).toBe('THUONG');
    expect(chooseManagedPriceType(lines, rankPriceTypeCodes(['THUONG', 'VIP'], 'VIP'), TODAY)).toBe('VIP');
  });

  it('mức xếp đầu chỉ có dòng ĐÃ HẾT HẠN → bỏ qua, lấy mức đang hiệu lực (khớp cách máy chủ tính tiền)', () => {
    const lines = [line('THUONG', 150_000, '2025-01-01', '2025-12-31'), line('VIP', 250_000)];
    expect(chooseManagedPriceType(lines, RANKED, TODAY)).toBe('VIP');
  });

  it('không mức nào hiệu lực hôm nay → mức xếp đầu trong mọi dòng đang có', () => {
    const lines = [line('VIP', 250_000, '2027-01-01'), line('THUONG', 150_000, '2027-01-01')];
    expect(chooseManagedPriceType(lines, RANKED, TODAY)).toBe('THUONG');
  });

  it('chưa có dòng nào → chuỗi rỗng', () => {
    expect(chooseManagedPriceType([], RANKED, TODAY)).toBe('');
  });

  it('mã không còn trong danh mục xếp sau mọi mã có trong danh mục', () => {
    expect(chooseManagedPriceType([line('MA_LA', 1), line('VIP', 2)], RANKED, TODAY)).toBe('VIP');
  });
});

describe('splitPriceLines', () => {
  it('một dòng hiện hành → current, không dòng ẩn', () => {
    const m = splitPriceLines([line('THUONG', 150_000)], RANKED, TODAY, 'THUONG');
    expect(m.priceTypeCode).toBe('THUONG');
    expect(m.current?.amount).toBe(150_000);
    expect(m.upcoming).toBeNull();
    expect(m.hidden).toEqual([]);
  });

  it('dòng hiện hành + dòng hẹn của cùng mức → current + upcoming', () => {
    const m = splitPriceLines([line('THUONG', 150_000, '2026-01-01', '2026-12-31'), line('THUONG', 180_000, '2027-01-01')], RANKED, TODAY, 'THUONG');
    expect(m.current?.amount).toBe(150_000);
    expect(m.upcoming).toMatchObject({ amount: 180_000, effectiveFrom: '2027-01-01' });
    expect(m.hidden).toEqual([]);
  });

  it('mức khác và dòng đã hết hạn nằm trong hidden', () => {
    const vip = line('VIP', 250_000);
    const old = line('THUONG', 120_000, '2024-01-01', '2025-12-31');
    const m = splitPriceLines([line('THUONG', 150_000, '2026-01-01'), vip, old], RANKED, TODAY, 'THUONG');
    expect(m.current?.amount).toBe(150_000);
    expect(m.hidden).toEqual([vip, old]);
  });

  it('dịch vụ mới (chưa có dòng) → dùng mức do nơi gọi chọn, current/upcoming rỗng', () => {
    const m = splitPriceLines([], RANKED, TODAY, 'VIP');
    expect(m).toEqual({ priceTypeCode: 'VIP', current: null, upcoming: null, hidden: [] });
  });
});

describe('buildPriceLines — mảng gửi API (lưu giá là "thay sạch" nên PHẢI mang theo dòng ẩn)', () => {
  it('BẪY 1: sửa giá hiện hành trên dịch vụ nhiều mức → các mức khác và dòng hết hạn vẫn còn NGUYÊN VẸN trong mảng gửi', () => {
    const vip = line('VIP', 250_000);
    const ngoaiGio = line('NGOAIGIO', 300_000, '2026-02-01');
    const old = line('THUONG', 120_000, '2024-01-01', '2025-12-31');
    const model = splitPriceLines([line('THUONG', 150_000), vip, ngoaiGio, old], RANKED, TODAY, 'THUONG');
    const out = buildPriceLines(model, { ...initialPriceFormInput(model), amount: 160_000 }, TODAY);

    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ priceTypeCode: 'THUONG', amount: 160_000, effectiveFrom: '2026-01-01' });
    expect(out).toContainEqual(vip);
    expect(out).toContainEqual(ngoaiGio);
    expect(out).toContainEqual(old);
  });

  it('không sửa gì → mảng gửi giống hệt dữ liệu ban đầu', () => {
    const lines = [line('THUONG', 150_000), line('VIP', 250_000)];
    const model = splitPriceLines(lines, RANKED, TODAY, 'THUONG');
    const out = buildPriceLines(model, initialPriceFormInput(model), TODAY);
    expect([...out].sort((a, b) => a.priceTypeCode.localeCompare(b.priceTypeCode))).toEqual([...lines].sort((a, b) => a.priceTypeCode.localeCompare(b.priceTypeCode)));
  });

  it('dịch vụ mới: một dòng hiệu lực từ hôm nay, không ngày kết thúc', () => {
    const model = splitPriceLines([], RANKED, TODAY, 'THUONG');
    const out = buildPriceLines(model, { amount: 150_000, unitCode: 'LUOT', scheduleEnabled: false, scheduleAmount: undefined, scheduleFrom: '' }, TODAY);
    expect(out).toEqual([{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 150_000, effectiveFrom: TODAY }]);
  });

  it('Hẹn đổi giá: dòng hiện hành đóng vào HÔM TRƯỚC ngày hẹn, thêm dòng giá mới từ ngày hẹn', () => {
    const model = splitPriceLines([line('THUONG', 150_000)], RANKED, TODAY, 'THUONG');
    const input: PriceFormInput = { ...initialPriceFormInput(model), scheduleEnabled: true, scheduleAmount: 180_000, scheduleFrom: '2027-01-01' };
    expect(buildPriceLines(model, input, TODAY)).toEqual([
      { priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 150_000, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' },
      { priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 180_000, effectiveFrom: '2027-01-01' },
    ]);
  });

  it('đổi ngày hẹn → ngày kết thúc của dòng hiện hành đổi theo', () => {
    const model = splitPriceLines([line('THUONG', 150_000, '2026-01-01', '2026-12-31'), line('THUONG', 180_000, '2027-01-01')], RANKED, TODAY, 'THUONG');
    const out = buildPriceLines(model, { ...initialPriceFormInput(model), scheduleFrom: '2027-02-01' }, TODAY);
    expect(out[0]).toMatchObject({ amount: 150_000, effectiveTo: '2027-01-31' });
    expect(out[1]).toMatchObject({ amount: 180_000, effectiveFrom: '2027-02-01' });
  });

  it('bỏ tích Hẹn đổi giá → dòng hẹn biến mất và dòng hiện hành mở lại (vô thời hạn)', () => {
    const model = splitPriceLines([line('THUONG', 150_000, '2026-01-01', '2026-12-31'), line('THUONG', 180_000, '2027-01-01')], RANKED, TODAY, 'THUONG');
    const out = buildPriceLines(model, { ...initialPriceFormInput(model), scheduleEnabled: false }, TODAY);
    expect(out).toEqual([{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 150_000, effectiveFrom: '2026-01-01' }]);
  });

  it('dòng hiện hành có ngày kết thúc KHÔNG do lần hẹn nào đặt → giữ nguyên khi không đụng tới Hẹn đổi giá', () => {
    const model = splitPriceLines([line('THUONG', 150_000, '2026-01-01', '2026-11-30')], RANKED, TODAY, 'THUONG');
    const out = buildPriceLines(model, { ...initialPriceFormInput(model), amount: 155_000 }, TODAY);
    expect(out).toEqual([{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 155_000, effectiveFrom: '2026-01-01', effectiveTo: '2026-11-30' }]);
  });

  it('đổi Đơn vị tính ở form áp cho cả dòng hiện hành lẫn dòng hẹn, không đụng đơn vị của dòng ẩn', () => {
    const vip = line('VIP', 250_000, '2026-01-01', undefined, 'PHIM');
    const model = splitPriceLines([line('THUONG', 150_000), vip], RANKED, TODAY, 'THUONG');
    const out = buildPriceLines(model, { ...initialPriceFormInput(model), unitCode: 'LAN', scheduleEnabled: true, scheduleAmount: 170_000, scheduleFrom: '2027-03-01' }, TODAY);
    expect(out.filter((l) => l.priceTypeCode === 'THUONG').map((l) => l.unitCode)).toEqual(['LAN', 'LAN']);
    expect(out).toContainEqual(vip);
  });

  it('không nhập giá hiện hành nhưng có hẹn → chỉ có dòng hẹn (dịch vụ chưa có giá tới ngày đó)', () => {
    const model = splitPriceLines([], RANKED, TODAY, 'THUONG');
    const out = buildPriceLines(model, { amount: undefined, unitCode: 'LUOT', scheduleEnabled: true, scheduleAmount: 180_000, scheduleFrom: '2027-01-01' }, TODAY);
    expect(out).toEqual([{ priceTypeCode: 'THUONG', unitCode: 'LUOT', amount: 180_000, effectiveFrom: '2027-01-01' }]);
  });

  it('không làm đổi các dòng gốc truyền vào (dòng ẩn được sao chép, không dùng chung tham chiếu)', () => {
    const vip = line('VIP', 250_000);
    const model = splitPriceLines([line('THUONG', 150_000), vip], RANKED, TODAY, 'THUONG');
    const out = buildPriceLines(model, initialPriceFormInput(model), TODAY);
    const sent = out.find((l) => l.priceTypeCode === 'VIP')!;
    expect(sent).toEqual(vip);
    expect(sent).not.toBe(vip);
  });
});

describe('validatePriceForm', () => {
  const base = (lines: TechnicalServicePriceLine[] = [line('THUONG', 150_000)]) => {
    const model = splitPriceLines(lines, RANKED, TODAY, 'THUONG');
    return { model, input: initialPriceFormInput(model) };
  };

  it('dịch vụ chỉ định ra ngoài (không thực hiện tại phòng khám) → không kiểm giá', () => {
    const { model } = base([]);
    expect(validatePriceForm(model, { amount: undefined, unitCode: '', scheduleEnabled: false, scheduleAmount: undefined, scheduleFrom: '' }, TODAY, false)).toBeNull();
  });

  it('dữ liệu hợp lệ → null', () => {
    const { model, input } = base();
    expect(validatePriceForm(model, input, TODAY, true)).toBeNull();
  });

  it('thiếu Đơn giá hoặc Đơn vị tính → báo lỗi cụ thể', () => {
    const { model, input } = base();
    expect(validatePriceForm(model, { ...input, amount: undefined }, TODAY, true)).toMatch(/Đơn giá/);
    expect(validatePriceForm(model, { ...input, unitCode: '' }, TODAY, true)).toMatch(/Đơn vị tính/);
  });

  it('phòng khám chưa có Loại giá nào (không gán được mức) → báo lỗi, không cho lưu giá', () => {
    const model = splitPriceLines([], [], TODAY, '');
    expect(validatePriceForm(model, { amount: 100, unitCode: 'LUOT', scheduleEnabled: false, scheduleAmount: undefined, scheduleFrom: '' }, TODAY, true)).toMatch(/Loại giá dịch vụ/);
  });

  it('Hẹn đổi giá: thiếu Giá mới / thiếu ngày / ngày không sau hôm nay → báo lỗi', () => {
    const { model, input } = base();
    const sched = { ...input, scheduleEnabled: true };
    expect(validatePriceForm(model, { ...sched, scheduleAmount: undefined, scheduleFrom: '2027-01-01' }, TODAY, true)).toMatch(/Giá mới/);
    expect(validatePriceForm(model, { ...sched, scheduleAmount: 1, scheduleFrom: '' }, TODAY, true)).toMatch(/ngày áp dụng/);
    expect(validatePriceForm(model, { ...sched, scheduleAmount: 1, scheduleFrom: TODAY }, TODAY, true)).toMatch(/sau hôm nay/);
    expect(validatePriceForm(model, { ...sched, scheduleAmount: 1, scheduleFrom: '2027-01-01' }, TODAY, true)).toBeNull();
  });

  it('dòng hẹn chồng lên một dòng ẩn cùng mức → báo lỗi thay vì để máy chủ từ chối', () => {
    const futureHidden = line('THUONG', 999, '2027-06-01', '2027-12-31');
    const current = line('THUONG', 150_000, '2026-01-01', '2026-12-31');

    const overlapping = splitPriceLines([current, line('THUONG', 180_000, '2027-01-01', '2027-08-31'), futureHidden], RANKED, TODAY, 'THUONG');
    expect(validatePriceForm(overlapping, initialPriceFormInput(overlapping), TODAY, true)).toMatch(/trùng/);

    const apart = splitPriceLines([current, line('THUONG', 180_000, '2027-01-01', '2027-05-31'), futureHidden], RANKED, TODAY, 'THUONG');
    expect(validatePriceForm(apart, initialPriceFormInput(apart), TODAY, true)).toBeNull();
  });
});

describe('hiddenOtherPriceTypeCodes', () => {
  it('liệt kê các mức KHÁC mức đang quản lý còn dòng giá (không tính dòng hết hạn của chính mức đó)', () => {
    const model = splitPriceLines(
      [line('THUONG', 150_000), line('THUONG', 100_000, '2024-01-01', '2025-12-31'), line('VIP', 250_000), line('NGOAIGIO', 300_000), line('VIP', 240_000, '2024-01-01', '2025-12-31')],
      RANKED,
      TODAY,
      'THUONG',
    );
    expect(hiddenOtherPriceTypeCodes(model).sort()).toEqual(['NGOAIGIO', 'VIP']);
  });

  it('chỉ một mức → không có mức ẩn', () => {
    expect(hiddenOtherPriceTypeCodes(splitPriceLines([line('THUONG', 150_000)], RANKED, TODAY, 'THUONG'))).toEqual([]);
  });
});
