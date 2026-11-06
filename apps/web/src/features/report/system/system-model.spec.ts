import { describe, expect, it } from 'vitest';
import {
  alertLink,
  axisLabelIndexes,
  branchLineStyle,
  BRANCH_LINE_STYLES,
  changePercent,
  describeKpiChange,
  formatSignedPercent,
  monthLabel,
  monthOptions,
  monthPeriodState,
  monthRangeOf,
  parseSystemTab,
  previousMonthOf,
  SYSTEM_TABS,
} from './system-model';

describe('tab của trang Toàn hệ thống', () => {
  it('parse tab: giá trị lạ hoặc rỗng → tab đầu; đủ 4 tab đúng thứ tự mockup', () => {
    expect(parseSystemTab(null)).toBe('overview');
    expect(parseSystemTab('khong-co')).toBe('overview');
    expect(SYSTEM_TABS.map((t) => t.label)).toEqual(['So sánh chi nhánh', 'Xếp hạng', 'Tổng hợp tháng', 'Khám chéo chi nhánh']);
    for (const t of SYSTEM_TABS) expect(parseSystemTab(t.id)).toBe(t.id);
  });
});

describe('so với kỳ trước', () => {
  const kpi = (value: number, previous: number, percent: number | null, direction: 'up' | 'down' | 'flat') => ({ value, previous, percent, direction });

  it('tăng = ▲ xanh lục, giảm = ▼ đỏ, số thập phân kiểu Việt', () => {
    expect(describeKpiChange(kpi(842, 777, 8.4, 'up'), 'kỳ trước')).toEqual({ text: '▲ 8,4% so với kỳ trước', tone: 'good' });
    expect(describeKpiChange(kpi(312, 319, -2.1, 'down'), 'kỳ trước')).toEqual({ text: '▼ 2,1% so với kỳ trước', tone: 'bad' });
  });

  it('không đổi và kỳ trước bằng 0 không tô màu', () => {
    expect(describeKpiChange(kpi(5, 5, 0, 'flat'), 'kỳ trước')).toEqual({ text: 'Không đổi so với kỳ trước', tone: undefined });
    expect(describeKpiChange(kpi(5, 0, null, 'up'), 'kỳ trước')).toEqual({ text: 'Kỳ trước chưa có số liệu', tone: undefined });
    expect(describeKpiChange(kpi(5, 0, null, 'up'), 'tháng 09/2026')).toEqual({ text: 'Tháng 09/2026 chưa có số liệu', tone: undefined });
  });

  it('formatSignedPercent và changePercent', () => {
    expect(formatSignedPercent(8.4)).toBe('+8,4%');
    expect(formatSignedPercent(-2.1)).toBe('-2,1%');
    expect(formatSignedPercent(0)).toBe('0%');
    expect(formatSignedPercent(null)).toBe('—');
    expect(changePercent(110, 100)).toBe(10);
    expect(changePercent(90, 100)).toBe(-10);
    expect(changePercent(5, 0)).toBeNull();
  });
});

describe('tháng', () => {
  it('nhãn, tháng trước (qua ranh giới năm), danh sách chọn mới nhất trước', () => {
    expect(monthLabel('2026-10')).toBe('Tháng 10/2026');
    expect(previousMonthOf('2026-11-05')).toBe('2026-10');
    expect(previousMonthOf('2026-01-15')).toBe('2025-12');
    const options = monthOptions('2026-02-10', 3);
    expect(options.map((o) => o.value)).toEqual(['2026-02', '2026-01', '2025-12']);
    expect(options[0]!.label).toBe('Tháng 02/2026');
    expect(monthOptions('2026-11-05')).toHaveLength(24);
  });

  it('monthRangeOf: ngày đầu và ngày cuối, tháng 2 nhuận; trạng thái kỳ giả không lỗi và mang đúng khoảng', () => {
    expect(monthRangeOf('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRangeOf('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    const state = monthPeriodState('2026-09', '2026-11-05');
    expect(state.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(state.error).toBeNull();
  });
});

describe('cần chú ý và biểu đồ', () => {
  it('mỗi loại cảnh báo dẫn tới một trang thật', () => {
    expect(alertLink('OPEN_SHIFTS')).toBe('/billing/cashier-shifts');
    expect(alertLink('OVERDUE_UNPAID')).toBe('/reports/revenue?tab=unpaid');
    expect(alertLink('EXPIRING_BATCHES')).toBe('/inventory/balances');
    expect(alertLink('LONG_WAIT')).toBe('/reports/operations?tab=waiting');
  });

  it('kiểu nét: mỗi chuỗi một màu và một nét khác nhau, quay vòng khi nhiều chi nhánh', () => {
    const first = BRANCH_LINE_STYLES.slice(0, 3);
    expect(new Set(first.map((s) => s.color)).size).toBe(3);
    expect(new Set(first.map((s) => s.dash)).size).toBe(3);
    expect(branchLineStyle(0)).toEqual(branchLineStyle(BRANCH_LINE_STYLES.length));
  });

  it('nhãn trục ngang: tối đa số nhãn, luôn có điểm đầu và cuối; ít điểm thì ghi hết', () => {
    expect(axisLabelIndexes(0, 6)).toEqual([]);
    expect(axisLabelIndexes(4, 6)).toEqual([0, 1, 2, 3]);
    const many = axisLabelIndexes(31, 6);
    expect(many.length).toBeLessThanOrEqual(6);
    expect(many[0]).toBe(0);
    expect(many[many.length - 1]).toBe(30);
    expect(many).toEqual([...many].sort((a, b) => a - b));
  });
});
