import { describe, expect, it } from 'vitest';
import { ageToneClass, deltaToneClass, formatAgeDays, formatAxisTick, formatDeltaPercent, formatSigned, niceAxis, recognizedMinusNet } from './revenue-model';

describe('formatDeltaPercent', () => {
  it('mũi tên theo chiều, dấu phẩy thập phân, "—" khi không có', () => {
    expect(formatDeltaPercent(12.5)).toBe('▲ 12,5%');
    expect(formatDeltaPercent(-10)).toBe('▼ 10,0%');
    expect(formatDeltaPercent(0)).toBe('0,0%');
    expect(formatDeltaPercent(null)).toBe('—');
  });
  it('màu theo chiều', () => {
    expect(deltaToneClass(5)).toContain('emerald');
    expect(deltaToneClass(-5)).toContain('rose');
    expect(deltaToneClass(null)).toContain('slate');
    expect(deltaToneClass(0)).toContain('slate');
  });
});

describe('formatSigned', () => {
  it('có dấu cộng/trừ và dấu chấm hàng nghìn', () => {
    expect(formatSigned(1200)).toBe('+1.200');
    expect(formatSigned(-10000)).toBe('-10.000');
    expect(formatSigned(0)).toBe('0');
  });
});

describe('niceAxis', () => {
  it('trần đẹp, 5 vạch đều từ 0, luôn ≥ giá trị lớn nhất', () => {
    const a = niceAxis(842_600_000);
    expect(a.unitLabel).toBe('Triệu đồng');
    expect(a.ticks).toHaveLength(5);
    expect(a.ticks[0]).toBe(0);
    expect(a.max).toBeGreaterThanOrEqual(842_600_000);
    expect(a.max).toBe(a.ticks[4]);
    const steps = a.ticks.slice(1).map((t, i) => t - a.ticks[i]!);
    expect(new Set(steps).size).toBe(1);
  });
  it('đơn vị theo độ lớn', () => {
    expect(niceAxis(5_000_000).unitLabel).toBe('Triệu đồng');
    expect(niceAxis(50_000).unitLabel).toBe('Nghìn đồng');
    expect(niceAxis(500).unitLabel).toBe('Đồng');
  });
  it('không có số liệu (0) vẫn ra trục hợp lệ', () => {
    const a = niceAxis(0);
    expect(a.max).toBeGreaterThan(0);
    expect(a.ticks[0]).toBe(0);
  });
  it('giá trị đúng bằng bội của bước vẫn nằm trong trục', () => {
    expect(niceAxis(900_000_000).max).toBeGreaterThanOrEqual(900_000_000);
  });
});

describe('formatAxisTick', () => {
  it('đổi theo đơn vị, bỏ số lẻ thừa', () => {
    expect(formatAxisTick(300_000_000, 1_000_000)).toBe('300');
    expect(formatAxisTick(1_500_000, 1_000_000)).toBe('1,5');
    expect(formatAxisTick(0, 1_000)).toBe('0');
  });
});

describe('tuổi phiếu và chênh lệch', () => {
  it('nhãn và màu', () => {
    expect(formatAgeDays(0)).toBe('Hôm nay');
    expect(formatAgeDays(12)).toBe('12 ngày');
    expect(ageToneClass(3)).toContain('slate');
    expect(ageToneClass(10)).toContain('amber');
    expect(ageToneClass(40)).toContain('rose');
    expect(recognizedMinusNet(1_360_000, 760_000)).toBe(600_000);
  });
});
