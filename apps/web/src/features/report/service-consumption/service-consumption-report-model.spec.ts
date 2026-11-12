import { describe, expect, it } from 'vitest';
import type { ServiceConsumptionByCustomerReport, ServiceConsumptionByServiceReport } from '@nexamed/shared';
import {
  buildServiceConsumptionByCustomerPrintSpec,
  buildServiceConsumptionByServicePrintSpec,
  parseServiceConsumptionTab,
  truncatedNote,
} from './service-consumption-report-model';

const header = { generatedAt: '2026-11-11T03:00:00.000Z', from: '2026-11-01', to: '2026-11-10', branchCount: 1, totalCost: 4_289_000, visitCount: 368, averageCost: 11_655, serviceOptions: [] };
const ctx = { from: '2026-11-01', to: '2026-11-10', scopeLabel: null };

const byService: ServiceConsumptionByServiceReport = {
  ...header,
  serviceCount: 2,
  rows: [
    { key: 'TECHNICAL_SERVICE:a', name: 'Lấy máu tĩnh mạch', visitCount: 180, cost: 1_440_000, averageCost: 8000, topItems: ['Ống EDTA', 'Kim 21G'] },
    { key: 'EXAM_TYPE:KT', name: 'Tiêm bắp', visitCount: 96, cost: 672_000, averageCost: 7000, topItems: [] },
  ],
};

const byCustomer: ServiceConsumptionByCustomerReport = {
  ...header,
  entryCount: 1,
  entries: [{ occurredAt: '2026-11-10T02:12:00.000Z', patientCode: 'BN000123', patientName: 'Nguyễn Văn An', serviceName: 'Lấy máu tĩnh mạch', itemsText: 'Ống EDTA ×1, Kim 21G ×1', doctorName: 'BS. Trần Minh', performerName: null, cost: 8000, branchName: 'Quận 1' }],
};

describe('parseServiceConsumptionTab', () => {
  it('nhận tab hợp lệ, rơi về "Theo dịch vụ" khi lạ hoặc thiếu', () => {
    expect(parseServiceConsumptionTab('by-customer')).toBe('by-customer');
    expect(parseServiceConsumptionTab('by-service')).toBe('by-service');
    expect(parseServiceConsumptionTab('xyz')).toBe('by-service');
    expect(parseServiceConsumptionTab(null)).toBe('by-service');
  });
});

describe('bản in "Theo dịch vụ"', () => {
  it('có dòng tổng quát, bảng đủ cột, dòng Cộng tính trên tất cả, không ghi chú cắt bớt khi đủ dòng', () => {
    const spec = buildServiceConsumptionByServicePrintSpec(byService, ctx);
    expect(spec.title).toBe('Chi phí vật tư theo dịch vụ');
    expect(spec.infoLines?.[0]).toContain('4.289.000');
    expect(spec.infoLines?.[0]).toContain('11.655');
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).toEqual(['Dịch vụ', 'Số lượt', 'Chi phí vốn', 'Trung bình / lượt', 'Dùng nhiều nhất']);
    expect(section.rows[0]).toEqual(['Lấy máu tĩnh mạch', '180', '1.440.000', '8.000', 'Ống EDTA, Kim 21G']);
    expect(section.totalRows?.[0]).toEqual(['Cộng 2 dịch vụ', '368', '4.289.000', '11.655', '']);
    expect(spec.note).toBeUndefined();
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
  it('một chi nhánh: không có cột Chi nhánh; ngày giờ theo giờ Việt Nam; thiếu người thực hiện hiện —', () => {
    const spec = buildServiceConsumptionByCustomerPrintSpec(byCustomer, ctx);
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).not.toContain('Chi nhánh');
    expect(section.rows[0]).toEqual(['10/11/2026 09:12', 'Nguyễn Văn An (BN000123)', 'Lấy máu tĩnh mạch', 'Ống EDTA ×1, Kim 21G ×1', 'BS. Trần Minh', '—', '8.000']);
  });
  it('gộp nhiều chi nhánh: thêm cột Chi nhánh và dòng Phạm vi', () => {
    const spec = buildServiceConsumptionByCustomerPrintSpec({ ...byCustomer, branchCount: 2 }, { ...ctx, scopeLabel: 'Tất cả chi nhánh (2)' });
    expect(spec.sections[0]!.columns.map((c) => c.header)).toContain('Chi nhánh');
    expect(spec.sections[0]!.rows[0]!.at(-1)).toBe('Quận 1');
    expect(spec.subtitleLines).toContain('Phạm vi: Tất cả chi nhánh (2)');
  });
});

describe('truncatedNote', () => {
  it('chỉ có khi tổng lớn hơn số đang hiện', () => {
    expect(truncatedNote(10, 10, 'lượt')).toBeUndefined();
    expect(truncatedNote(10, 25, 'lượt')).toContain('25');
  });
});
