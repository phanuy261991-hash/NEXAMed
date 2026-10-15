import { describe, expect, it } from 'vitest';
import { CURRENT_REPORT_SCOPE, isMultiBranchScope, parseStoredReportScope, toQueryString, toReportScopeApiQuery } from './report-scope';

describe('parseStoredReportScope', () => {
  it('dữ liệu hỏng hoặc lạ → chi nhánh đang làm', () => {
    expect(parseStoredReportScope(null)).toEqual(CURRENT_REPORT_SCOPE);
    expect(parseStoredReportScope('all')).toEqual(CURRENT_REPORT_SCOPE);
    expect(parseStoredReportScope({ scope: 'everything' })).toEqual(CURRENT_REPORT_SCOPE);
  });

  it('giữ `all`, bỏ branchIds thừa', () => {
    expect(parseStoredReportScope({ scope: 'all', branchIds: ['x'] })).toEqual({ scope: 'all', branchIds: [] });
  });

  it('`pick` phải có ít nhất 1 chi nhánh, nếu không quay về chi nhánh đang làm', () => {
    expect(parseStoredReportScope({ scope: 'pick', branchIds: ['a', 'b'] })).toEqual({ scope: 'pick', branchIds: ['a', 'b'] });
    expect(parseStoredReportScope({ scope: 'pick', branchIds: [] })).toEqual(CURRENT_REPORT_SCOPE);
    expect(parseStoredReportScope({ scope: 'pick', branchIds: [1, 'a'] })).toEqual({ scope: 'pick', branchIds: ['a'] });
  });
});

describe('toReportScopeApiQuery', () => {
  it('`current` không gửi thêm tham số — request y hệt trước Đợt 3', () => {
    expect(toReportScopeApiQuery({ from: '2026-10-01', to: '2026-10-15', scope: 'current', branchIds: [] })).toEqual({ from: '2026-10-01', to: '2026-10-15' });
  });

  it('`all` chỉ gửi scope', () => {
    expect(toReportScopeApiQuery({ from: '2026-10-01', scope: 'all', branchIds: ['bỏ qua'] })).toEqual({ from: '2026-10-01', scope: 'all' });
  });

  it('`pick` gửi scope và branchIds dạng chuỗi cách nhau bằng dấu phẩy', () => {
    expect(toReportScopeApiQuery({ scope: 'pick', branchIds: ['a', 'b'] })).toEqual({ scope: 'pick', branchIds: 'a,b' });
  });
});

describe('toQueryString', () => {
  it('bỏ giá trị rỗng/undefined', () => {
    expect(toQueryString({ from: '2026-10-01', warehouseId: undefined, drugId: '', scope: 'all' })).toBe('from=2026-10-01&scope=all');
  });
});

describe('isMultiBranchScope', () => {
  it('chỉ từ 2 chi nhánh trở lên mới hiện cột/bảng chi nhánh', () => {
    expect(isMultiBranchScope(0)).toBe(false);
    expect(isMultiBranchScope(1)).toBe(false);
    expect(isMultiBranchScope(2)).toBe(true);
  });
});
