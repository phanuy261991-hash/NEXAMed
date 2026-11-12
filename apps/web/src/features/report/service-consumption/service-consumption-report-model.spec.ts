import { describe, expect, it } from 'vitest';
import type { ServiceConsumptionByBranchReport, ServiceConsumptionByCustomerReport, ServiceConsumptionByItemReport, ServiceConsumptionByServiceReport } from '@nexamed/shared';
import {
  buildServiceConsumptionByBranchPrintSpec,
  buildServiceConsumptionByCustomerPrintSpec,
  buildServiceConsumptionByItemPrintSpec,
  buildServiceConsumptionByServicePrintSpec,
  describeItemServices,
  formatItemQuantity,
  parseServiceConsumptionTab,
  truncatedNote,
  visibleServiceConsumptionTabs,
} from './service-consumption-report-model';

const header = {
  generatedAt: '2026-11-11T03:00:00.000Z',
  from: '2026-11-01',
  to: '2026-11-10',
  branchCount: 1,
  totalCost: 4_289_000,
  visitCount: 368,
  averageCost: 11_655,
  totalRevenue: 30_000_000,
  totalMargin: 25_711_000,
  marginPercent: 85.7,
  serviceOptions: [],
};
const ctx = { from: '2026-11-01', to: '2026-11-10', scopeLabel: null };

const byService: ServiceConsumptionByServiceReport = {
  ...header,
  serviceCount: 2,
  rows: [
    { key: 'TECHNICAL_SERVICE:a', name: 'Lấy máu tĩnh mạch', visitCount: 180, cost: 1_440_000, averageCost: 8000, revenue: 9_000_000, margin: 7_560_000, marginPercent: 84, topItems: ['Ống EDTA', 'Kim 21G'] },
    { key: 'EXAM_TYPE:KT', name: 'Tiêm bắp', visitCount: 96, cost: 672_000, averageCost: 7000, revenue: 0, margin: -672_000, marginPercent: null, topItems: [] },
  ],
};

const byCustomer: ServiceConsumptionByCustomerReport = {
  ...header,
  entryCount: 1,
  entries: [
    { occurredAt: '2026-11-10T02:12:00.000Z', patientCode: 'BN000123', patientName: 'Nguyễn Văn An', serviceName: 'Lấy máu tĩnh mạch', itemsText: 'Ống EDTA ×1, Kim 21G ×1', doctorName: 'BS. Trần Minh', performerName: null, cost: 8000, revenue: 50_000, margin: 42_000, refunded: false, branchName: 'Quận 1' },
  ],
};

const byItem: ServiceConsumptionByItemReport = {
  generatedAt: header.generatedAt,
  from: header.from,
  to: header.to,
  branchCount: 1,
  totalCost: 24_658_000,
  itemCount: 2,
  medicineCount: 1,
  supplyCount: 1,
  topItem: { name: 'Ống soi dùng 1 lần', sharePercent: 24.3 },
  serviceOptions: [],
  rows: [
    { key: 'a', name: 'Ống soi dùng 1 lần', itemType: 'SUPPLY', serviceNames: ['Nội soi tai mũi họng'], serviceCount: 1, quantity: 60, unitName: 'cái', averageUnitCost: 100_000, cost: 6_000_000, sharePercent: 24.3 },
    { key: 'b', name: 'Lidocain 2%', itemType: 'MEDICINE', serviceNames: ['Khâu vết thương', 'Tiêm bắp'], serviceCount: 3, quantity: 36, unitName: '', averageUnitCost: null, cost: 1_512_000, sharePercent: null },
  ],
};

const byBranch: ServiceConsumptionByBranchReport = {
  ...header,
  branchCount: 2,
  rows: [
    { branchId: 'b1', branchName: 'Chi nhánh Quận 1', visitCount: 260, revenue: 51_200_000, cost: 12_300_000, averageCost: 47_308, margin: 38_900_000, marginPercent: 76 },
    { branchId: 'b2', branchName: 'Chi nhánh Thủ Đức', visitCount: 0, revenue: 0, cost: 0, averageCost: null, margin: 0, marginPercent: null },
  ],
};

describe('tab của trang', () => {
  it('bốn tab theo thứ tự; công ty một chi nhánh không có tab "Theo chi nhánh"', () => {
    expect(visibleServiceConsumptionTabs(true).map((t) => t.id)).toEqual(['by-service', 'by-customer', 'by-item', 'by-branch']);
    expect(visibleServiceConsumptionTabs(false).map((t) => t.id)).toEqual(['by-service', 'by-customer', 'by-item']);
  });
  it('nhận tab hợp lệ, rơi về "Theo dịch vụ" khi lạ hoặc thiếu; mở thẳng ?tab=by-branch khi không chọn được chi nhánh cũng rơi về tab đầu', () => {
    expect(parseServiceConsumptionTab('by-customer')).toBe('by-customer');
    expect(parseServiceConsumptionTab('by-item')).toBe('by-item');
    expect(parseServiceConsumptionTab('by-branch')).toBe('by-branch');
    expect(parseServiceConsumptionTab('by-branch', false)).toBe('by-service');
    expect(parseServiceConsumptionTab('xyz')).toBe('by-service');
    expect(parseServiceConsumptionTab(null)).toBe('by-service');
  });
});

describe('bản in "Theo dịch vụ"', () => {
  it('có dòng tổng quát kèm doanh thu và lãi gộp, bảng đủ cột, dòng Cộng tính trên tất cả, không ghi chú cắt bớt khi đủ dòng', () => {
    const spec = buildServiceConsumptionByServicePrintSpec(byService, ctx);
    expect(spec.title).toBe('Chi phí vật tư theo dịch vụ');
    expect(spec.infoLines?.[0]).toContain('4.289.000');
    expect(spec.infoLines?.[0]).toContain('Doanh thu dịch vụ: 30.000.000');
    expect(spec.infoLines?.[0]).toContain('biên 85,7%');
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).toEqual(['Dịch vụ', 'Số lượt', 'Doanh thu', 'Chi phí vốn', 'Trung bình / lượt', 'Lãi gộp', 'Biên', 'Dùng nhiều nhất']);
    expect(section.rows[0]).toEqual(['Lấy máu tĩnh mạch', '180', '9.000.000', '1.440.000', '8.000', '7.560.000', '84%', 'Ống EDTA, Kim 21G']);
    expect(section.totalRows?.[0]).toEqual(['Cộng 2 dịch vụ', '368', '30.000.000', '4.289.000', '11.655', '25.711.000', '85,7%', '']);
    expect(spec.note).toBeUndefined();
  });
  it('lãi gộp âm giữ dấu trừ; doanh thu 0 thì biên hiện —', () => {
    const row = buildServiceConsumptionByServicePrintSpec(byService, ctx).sections[0]!.rows[1]!;
    expect(row[5]).toBe('-672.000');
    expect(row[6]).toBe('—');
  });
  it('ghi chú khi bị cắt bớt; chưa có lượt thì trung bình hiện —', () => {
    const capped = buildServiceConsumptionByServicePrintSpec({ ...byService, serviceCount: 1500 }, ctx);
    expect(capped.note).toContain('1.500');
    const empty = buildServiceConsumptionByServicePrintSpec({ ...byService, visitCount: 0, totalCost: 0, averageCost: null, serviceCount: 0, rows: [] }, ctx);
    expect(empty.infoLines?.[0]).toContain('Trung bình mỗi lượt: —');
    expect(empty.sections[0]!.rows).toEqual([]);
  });
});

describe('bản in "Theo khách"', () => {
  it('một chi nhánh: không có cột Chi nhánh; ngày giờ theo giờ Việt Nam; thiếu người thực hiện hiện —; có doanh thu và lãi gộp từng lượt', () => {
    const spec = buildServiceConsumptionByCustomerPrintSpec(byCustomer, ctx);
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).not.toContain('Chi nhánh');
    expect(section.rows[0]).toEqual(['10/11/2026 09:12', 'Nguyễn Văn An (BN000123)', 'Lấy máu tĩnh mạch', 'Ống EDTA ×1, Kim 21G ×1', 'BS. Trần Minh', '—', '50.000', '8.000', '42.000']);
    expect(section.totalRows?.[0]).toEqual(['Cộng', '', '', '', '', '', '30.000.000', '4.289.000', '25.711.000']);
  });
  it('lượt đã hoàn tiền được ghi chú ngay ở ô doanh thu; lãi gộp âm giữ dấu trừ', () => {
    const refunded = { ...byCustomer, entries: [{ ...byCustomer.entries[0]!, revenue: 0, margin: -8000, refunded: true }] };
    const row = buildServiceConsumptionByCustomerPrintSpec(refunded, ctx).sections[0]!.rows[0]!;
    expect(row[6]).toBe('0 (đã hoàn tiền)');
    expect(row[8]).toBe('-8.000');
  });
  it('gộp nhiều chi nhánh: thêm cột Chi nhánh và dòng Phạm vi', () => {
    const spec = buildServiceConsumptionByCustomerPrintSpec({ ...byCustomer, branchCount: 2 }, { ...ctx, scopeLabel: 'Tất cả chi nhánh (2)' });
    expect(spec.sections[0]!.columns.map((c) => c.header)).toContain('Chi nhánh');
    expect(spec.sections[0]!.rows[0]!.at(-1)).toBe('Quận 1');
    expect(spec.subtitleLines).toContain('Phạm vi: Tất cả chi nhánh (2)');
  });
  it('danh sách bị cắt bớt thì không in dòng Cộng (không cộng sai) mà ghi chú', () => {
    const spec = buildServiceConsumptionByCustomerPrintSpec({ ...byCustomer, entryCount: 5000 }, ctx);
    expect(spec.sections[0]!.totalRows).toBeUndefined();
    expect(spec.note).toContain('5.000');
  });
});

describe('bản in "Theo vật tư"', () => {
  it('bảng đủ cột; số lượng kèm đơn vị; thiếu giá vốn trung bình và tỷ trọng thì —', () => {
    const spec = buildServiceConsumptionByItemPrintSpec(byItem, ctx);
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).toEqual(['Mặt hàng', 'Loại', 'Dùng ở', 'Số lượng', 'Giá vốn TB / đơn vị', 'Chi phí vốn', 'Tỷ trọng']);
    expect(section.rows[0]).toEqual(['Ống soi dùng 1 lần', 'Vật tư', 'Nội soi tai mũi họng', '60 cái', '100.000', '6.000.000', '24,3%']);
    expect(section.rows[1]).toEqual(['Lidocain 2%', 'Thuốc', 'Khâu vết thương, Tiêm bắp và 1 dịch vụ khác', '36', '—', '1.512.000', '—']);
    expect(section.totalRows?.[0]).toEqual(['Cộng 2 mặt hàng', '', '', '', '', '24.658.000', '100%']);
    expect(spec.infoLines?.[0]).toContain('1 vật tư, 1 thuốc');
  });
  it('mô tả dịch vụ dùng và số lượng', () => {
    expect(describeItemServices([], 0)).toBe('—');
    expect(describeItemServices(['A', 'B'], 2)).toBe('A, B');
    expect(describeItemServices(['A', 'B'], 5)).toBe('A, B và 3 dịch vụ khác');
    expect(formatItemQuantity(3000, 'ml')).toBe('3.000 ml');
    expect(formatItemQuantity(3, '')).toBe('3');
  });
});

describe('bản in "Theo chi nhánh"', () => {
  it('mỗi chi nhánh một dòng, chi nhánh chưa có lượt hiện 0 và —; dòng Cộng lấy tổng toàn phạm vi', () => {
    const spec = buildServiceConsumptionByBranchPrintSpec(byBranch, { ...ctx, scopeLabel: 'Tất cả chi nhánh (2)' });
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).toEqual(['Chi nhánh', 'Số lượt', 'Doanh thu', 'Chi phí vốn', 'Trung bình / lượt', 'Lãi gộp', 'Biên']);
    expect(section.rows[0]).toEqual(['Chi nhánh Quận 1', '260', '51.200.000', '12.300.000', '47.308', '38.900.000', '76%']);
    expect(section.rows[1]).toEqual(['Chi nhánh Thủ Đức', '0', '0', '0', '—', '0', '—']);
    expect(section.totalRows?.[0]?.[0]).toBe('Cộng 2 chi nhánh');
    expect(spec.subtitleLines).toContain('Phạm vi: Tất cả chi nhánh (2)');
  });
});

describe('truncatedNote', () => {
  it('chỉ có khi tổng lớn hơn số đang hiện', () => {
    expect(truncatedNote(10, 10, 'lượt')).toBeUndefined();
    expect(truncatedNote(10, 25, 'lượt')).toContain('25');
  });
});
