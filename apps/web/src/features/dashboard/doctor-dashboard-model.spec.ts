import { describe, expect, it } from 'vitest';
import type { DoctorDashboard } from '@nexamed/shared';
import { averagePerDayText, buildDoctorHourlyChart, doneText, inProgressText, longestWaitText, patientSubtitle, peakText } from './doctor-dashboard-model';

const hourly = (counts: Record<number, number>): DoctorDashboard['hourly'] => Array.from({ length: 24 }, (_, hour) => ({ hour, count: counts[hour] ?? 0 }));

describe('chữ dòng phụ của dải số', () => {
  it('trung bình mỗi ngày: có số và chưa có số', () => {
    expect(averagePerDayText(12)).toBe('trung bình 12 lượt/ngày');
    expect(averagePerDayText(null)).toBe('chưa có số ngày trước để so');
  });
  it('người chờ lâu nhất: phút, giờ, không ai chờ', () => {
    expect(longestWaitText(14)).toBe('người chờ lâu nhất 14 phút');
    expect(longestWaitText(65)).toBe('người chờ lâu nhất 1 giờ 5 phút');
    expect(longestWaitText(null)).toBe('không có ai đang chờ');
  });
  it('đang khám: tên + số phút, báo thêm khi có nhiều ca, hoặc chưa ai', () => {
    expect(inProgressText({ count: 1, patientName: 'Nguyễn Thị Lan', minutes: 8 })).toBe('Nguyễn Thị Lan · 8 phút');
    expect(inProgressText({ count: 2, patientName: 'Nguyễn Thị Lan', minutes: 8 })).toBe('Nguyễn Thị Lan (+1) · 8 phút');
    expect(inProgressText({ count: 0, patientName: null, minutes: null })).toBe('chưa có ai đang khám');
  });
  it('đã xong: trung bình, chưa đủ giờ, chưa có lượt nào', () => {
    expect(doneText({ count: 10, averageMinutes: 11 })).toBe('trung bình 11 phút mỗi lượt');
    expect(doneText({ count: 3, averageMinutes: null })).toBe('chưa đủ giờ để tính trung bình');
    expect(doneText({ count: 0, averageMinutes: null })).toBe('chưa có lượt nào xong');
  });
  it('bệnh nhân chờ: mã + tuổi, thiếu ngày sinh chỉ mã', () => {
    expect(patientSubtitle({ patientCode: 'BN00188', age: 52 })).toBe('BN00188 · 52 tuổi');
    expect(patientSubtitle({ patientCode: 'BN00188', age: null })).toBe('BN00188');
  });
});

describe('buildDoctorHourlyChart', () => {
  it('hiển thị 07–18, giờ đông nhất xanh đậm, giờ hiện tại được đánh dấu', () => {
    const chart = buildDoctorHourlyChart(hourly({ 7: 1, 8: 2, 10: 3, 14: 2 }), 14);
    expect(chart.items.map((i) => i.label)).toEqual(['07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18']);
    expect(chart.peak).toEqual({ hour: 10, count: 3 });
    expect(chart.items[3]!.segments[0]!.className).toBe('bg-blue-600');
    expect(chart.items[0]!.segments[0]!.className).toBe('bg-blue-300');
    expect(chart.currentIndex).toBe(7);
    expect(chart.total).toBe(8);
    expect(peakText(chart.peak)).toBe('đông nhất 10:00 — 3 lượt');
  });
  it('mở rộng khi có lượt ngoài khoảng mặc định; giờ hiện tại ngoài khoảng thì không đánh dấu', () => {
    const chart = buildDoctorHourlyChart(hourly({ 5: 1, 20: 1 }), 3);
    expect(chart.items[0]!.label).toBe('05');
    expect(chart.items.at(-1)!.label).toBe('20');
    expect(chart.currentIndex).toBeNull();
  });
  it('chưa có lượt nào: không có giờ đông nhất, không chữ thừa', () => {
    const chart = buildDoctorHourlyChart(hourly({}), 10);
    expect(chart.peak).toBeNull();
    expect(chart.total).toBe(0);
    expect(peakText(chart.peak)).toBe('');
  });
});
