import { describe, expect, it } from 'vitest';
import { doctorCardTitle, doctorVisitBookLink, formatDecimal, formatDuration, formatHours, formatWholePercent, utilizationToneClass } from './doctors-model';

describe('định dạng', () => {
  it('thời lượng', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(13)).toBe('13 phút');
    expect(formatDuration(120)).toBe('2 giờ');
    expect(formatDuration(125)).toBe('2 giờ 05 phút');
  });
  it('số giờ một chữ số thập phân kiểu Việt', () => {
    expect(formatHours(690)).toBe('11,5 giờ');
    expect(formatHours(0)).toBe('0 giờ');
    expect(formatHours(60)).toBe('1 giờ');
  });
  it('số thập phân và phần trăm nguyên', () => {
    expect(formatDecimal(1.5)).toBe('1,5');
    expect(formatDecimal(null)).toBe('—');
    expect(formatWholePercent(46.6)).toBe('47%');
    expect(formatWholePercent(null)).toBe('—');
  });
});

describe('tiêu đề khung và đường dẫn', () => {
  it('"tháng" viết thường sau dấu phẩy, khoảng tuỳ chọn giữ nguyên', () => {
    expect(doctorCardTitle('Tháng 10/2026')).toBe('Bác sĩ, tháng 10/2026');
    expect(doctorCardTitle('01/10/2026 – 15/10/2026')).toBe('Bác sĩ, 01/10/2026 – 15/10/2026');
  });
  it('đường dẫn Xem mang bác sĩ và kỳ', () => {
    const link = doctorVisitBookLink('abc', '2026-10-01', '2026-10-31');
    expect(link).toBe('/reports/operations?doctorId=abc&from=2026-10-01&to=2026-10-31');
  });
});

describe('utilizationToneClass', () => {
  it('thấp hổ phách, cao xanh lục, không có ca xám', () => {
    expect(utilizationToneClass(null)).toContain('slate-600');
    expect(utilizationToneClass(10)).toContain('amber');
    expect(utilizationToneClass(60)).toContain('slate-800');
    expect(utilizationToneClass(90)).toContain('emerald');
  });
});
