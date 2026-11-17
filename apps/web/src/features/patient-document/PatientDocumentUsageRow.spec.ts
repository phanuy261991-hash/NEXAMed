import { describe, expect, it } from 'vitest';
import { diskUsedPercent, usageText } from './PatientDocumentUsageRow';

const GB = 1024 ** 3;

describe('diskUsedPercent', () => {
  it('phần trăm ổ chứa kho đã đầy = (tổng − còn trống) ÷ tổng, làm tròn', () => {
    expect(diskUsedPercent(100 * GB, 82 * GB)).toBe(18);
    expect(diskUsedPercent(500 * GB, 125 * GB)).toBe(75);
    expect(diskUsedPercent(100 * GB, 0)).toBe(100);
    expect(diskUsedPercent(100 * GB, 100 * GB)).toBe(0);
  });

  it('không ra ngoài 0–100 dù số liệu lệch (còn trống lớn hơn tổng)', () => {
    expect(diskUsedPercent(100 * GB, 150 * GB)).toBe(0);
  });

  it('ổ không báo dung lượng (null/0) thì không vẽ thanh', () => {
    expect(diskUsedPercent(null, 10 * GB)).toBeNull();
    expect(diskUsedPercent(100 * GB, null)).toBeNull();
    expect(diskUsedPercent(0, 0)).toBeNull();
  });
});

describe('usageText', () => {
  it('dung lượng và số tệp theo kiểu Việt Nam', () => {
    expect(usageText(Math.round(12.4 * GB), 4310)).toBe('12,4 GB · 4.310 tệp');
    expect(usageText(0, 0)).toBe('0 B · 0 tệp');
  });
});
