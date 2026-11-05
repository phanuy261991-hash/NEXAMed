import { describe, expect, it } from 'vitest';
import { exportLabel, filterReportCatalog, groupReportCatalog, REPORT_CATALOG, reportsMissingExports } from './report-catalog';

describe('REPORT_CATALOG', () => {
  it('mã báo cáo không trùng, đường dẫn bắt đầu bằng /, quyền đủ module và hành động', () => {
    const ids = REPORT_CATALOG.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of REPORT_CATALOG) {
      expect(r.to.startsWith('/')).toBe(true);
      expect(r.permission[0]).not.toBe('');
      expect(r.permission[1]).not.toBe('');
    }
  });

  it('Báo cáo ngày có cả Excel lẫn In và nằm trong danh mục', () => {
    const daily = REPORT_CATALOG.find((r) => r.id === 'daily');
    expect(daily).toMatchObject({ excel: true, print: true, to: '/reports/daily', permission: ['daily_report', 'read'] });
  });

  // Quy tắc 05/11/2026 (#287): MỌI báo cáo phải có Excel và In. Thêm báo cáo mới vào danh mục mà thiếu một trong hai sẽ làm test này đỏ.
  it('mọi báo cáo trong danh mục đều có cả Excel lẫn In', () => {
    expect(reportsMissingExports().map((r) => r.id)).toEqual([]);
    expect(REPORT_CATALOG.every((r) => exportLabel(r) === 'Excel · In')).toBe(true);
  });

  it('reportsMissingExports nêu đúng báo cáo thiếu một trong hai', () => {
    const base = REPORT_CATALOG[0]!;
    expect(reportsMissingExports([base, { ...base, id: 'a', excel: false }, { ...base, id: 'b', print: false }]).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('exportLabel', () => {
  it('ghi đúng thực tế: cả hai, chỉ Excel, chỉ In, hoặc gạch ngang', () => {
    expect(exportLabel({ excel: true, print: true })).toBe('Excel · In');
    expect(exportLabel({ excel: true, print: false })).toBe('Excel');
    expect(exportLabel({ excel: false, print: true })).toBe('In');
    expect(exportLabel({ excel: false, print: false })).toBe('—');
  });
});

describe('filterReportCatalog', () => {
  const items = [
    { name: 'Báo cáo ngày', description: 'Lượt khám, tiền thu', group: 'Doanh thu và thu chi' },
    { name: 'Nhập-Xuất-Tồn', description: 'Đầu kỳ, nhập, xuất', group: 'Thuốc và vật tư' },
  ];

  it('không phân biệt hoa thường và dấu; tìm cả trong mô tả và tên nhóm', () => {
    expect(filterReportCatalog(items, 'bao cao').map((i) => i.name)).toEqual(['Báo cáo ngày']);
    expect(filterReportCatalog(items, 'NHAP xuat').map((i) => i.name)).toEqual(['Nhập-Xuất-Tồn']);
    expect(filterReportCatalog(items, 'xuat-ton').map((i) => i.name)).toEqual(['Nhập-Xuất-Tồn']);
    expect(filterReportCatalog(items, 'nhap ton').length).toBe(0);
    expect(filterReportCatalog(items, 'nhập-xuất').map((i) => i.name)).toEqual(['Nhập-Xuất-Tồn']);
    expect(filterReportCatalog(items, 'thuoc').map((i) => i.name)).toEqual(['Nhập-Xuất-Tồn']);
    expect(filterReportCatalog(items, 'luot kham').map((i) => i.name)).toEqual(['Báo cáo ngày']);
  });

  it('từ khoá rỗng hoặc toàn dấu cách giữ nguyên danh sách', () => {
    expect(filterReportCatalog(items, '   ')).toHaveLength(2);
    expect(filterReportCatalog(items, '')).toHaveLength(2);
  });
});

describe('groupReportCatalog', () => {
  it('gom theo nhóm, giữ thứ tự xuất hiện đầu tiên, không có nhóm rỗng', () => {
    const grouped = groupReportCatalog([{ group: 'B', n: 1 }, { group: 'A', n: 2 }, { group: 'B', n: 3 }]);
    expect(grouped.map((g) => [g.group, g.items.map((i) => i.n)])).toEqual([
      ['B', [1, 3]],
      ['A', [2]],
    ]);
    expect(groupReportCatalog([])).toEqual([]);
  });
});
