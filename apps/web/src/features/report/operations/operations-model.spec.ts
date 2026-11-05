import { describe, expect, it } from 'vitest';
import { barWidthPercent, formatCount, formatDayMonth, formatMinutes, formatPeak, formatPercent, heatCellStyle, heatMax, sourceLabel } from './operations-model';

describe('định dạng', () => {
  it('phần trăm dùng dấu phẩy, mẫu số 0 là "—"', () => {
    expect(formatPercent(14.2)).toBe('14,2%');
    expect(formatPercent(50)).toBe('50%');
    expect(formatPercent(null)).toBe('—');
  });
  it('phút, số lượng, ngày/tháng', () => {
    expect(formatMinutes(17)).toBe('17 phút');
    expect(formatMinutes(null)).toBe('—');
    expect(formatCount(1284)).toBe((1284).toLocaleString('vi-VN'));
    expect(formatDayMonth('2026-11-04')).toBe('04/11');
    expect(formatDayMonth('hỏng')).toBe('hỏng');
  });
  it('giờ cao điểm và nguồn lạ', () => {
    expect(formatPeak({ isoDow: 1, hour: 9 })).toBe('Thứ Hai 9h');
    expect(formatPeak({ isoDow: 7, hour: 19 })).toBe('Chủ nhật 19h');
    expect(formatPeak(null)).toBe('—');
    expect(sourceLabel('phone', { phone: 'Điện thoại' })).toBe('Điện thoại');
    expect(sourceLabel('fax', { phone: 'Điện thoại' })).toBe('fax');
  });
});

describe('bản đồ nhiệt', () => {
  it('ô ít nhất là màu nhạt, ô nhiều nhất là xanh đậm chữ trắng, khớp mockup', () => {
    expect(heatCellStyle(0, 36)).toEqual({ background: 'rgb(241, 245, 249)', color: '#1e293b' });
    expect(heatCellStyle(36, 36)).toEqual({ background: 'rgb(30, 58, 138)', color: '#ffffff' });
  });
  it('chữ chỉ đổi sang trắng khi quá nửa thang', () => {
    expect(heatCellStyle(18, 36).color).toBe('#1e293b');
    expect(heatCellStyle(19, 36).color).toBe('#ffffff');
  });
  it('max bằng 0 hoặc số ngoài thang không làm hỏng màu', () => {
    expect(heatCellStyle(5, 0).background).toBe('rgb(241, 245, 249)');
    expect(heatCellStyle(99, 36).background).toBe('rgb(30, 58, 138)');
    expect(heatCellStyle(-3, 36).background).toBe('rgb(241, 245, 249)');
  });
  it('heatMax lấy ô lớn nhất của mọi hàng', () => {
    expect(heatMax([{ counts: [1, 9, 2] }, { counts: [5, 36, 0] }])).toBe(36);
    expect(heatMax([])).toBe(0);
  });
});

describe('barWidthPercent', () => {
  it('tỉ lệ theo max, kẹp trong 0–100', () => {
    expect(barWidthPercent(235, 470)).toBe(50);
    expect(barWidthPercent(470, 470)).toBe(100);
    expect(barWidthPercent(5, 0)).toBe(0);
    expect(barWidthPercent(999, 470)).toBe(100);
  });
});
