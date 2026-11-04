import { describe, expect, it } from 'vitest';
import { formatMillions, niceScale } from './chart-scale';

describe('niceScale', () => {
  it('chọn bước tròn phủ trọn giá trị lớn nhất', () => {
    expect(niceScale(12)).toEqual({ max: 15, ticks: [0, 5, 10, 15] });
    expect(niceScale(7)).toEqual({ max: 9, ticks: [0, 3, 6, 9] });
    expect(niceScale(19.4)).toEqual({ max: 24, ticks: [0, 8, 16, 24] });
  });

  it('mức trần luôn >= giá trị lớn nhất và các vạch cách đều', () => {
    for (const value of [0.4, 1, 3, 7, 12, 19.4, 48, 99, 1500, 18_100_000]) {
      const { max, ticks } = niceScale(value);
      expect(max).toBeGreaterThanOrEqual(value);
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)).toBe(max);
      const steps = ticks.slice(1).map((t, i) => t - ticks[i]!);
      expect(new Set(steps.map((s) => Math.round(s * 1e6))).size).toBe(1);
    }
  });

  it('chừa ít khoảng trống hơn khi đặt headroom nhỏ (biểu đồ cột: 19,4 triệu → trần 20 triệu)', () => {
    expect(niceScale(19_400_000, 2, 1.03)).toEqual({ max: 20_000_000, ticks: [0, 10_000_000, 20_000_000] });
  });

  it('không có dữ liệu (0 hoặc âm) → thang 0–3', () => {
    expect(niceScale(0)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
    expect(niceScale(-5)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
  });
});

describe('formatMillions', () => {
  it('làm tròn 1 chữ số thập phân, dùng dấu phẩy', () => {
    expect(formatMillions(18_100_000)).toBe('18,1');
    expect(formatMillions(12_600_000)).toBe('12,6');
    expect(formatMillions(600_000)).toBe('0,6');
    expect(formatMillions(20_000_000)).toBe('20');
    expect(formatMillions(0)).toBe('0');
  });
});
