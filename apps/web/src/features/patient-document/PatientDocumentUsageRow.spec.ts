import { describe, expect, it } from 'vitest';
import { usagePercent, usageText } from './PatientDocumentUsageRow';

const GB = 1024 ** 3;

describe('usagePercent', () => {
  it('phần trăm tệp chiếm so với ổ chứa kho, làm tròn', () => {
    expect(usagePercent(18 * GB, 100 * GB)).toBe(18);
    expect(usagePercent(12.4 * GB, 100 * GB)).toBe(12);
  });

  it('có tệp mà quá nhỏ so với ổ thì vẫn hiện tối thiểu 1% để thanh còn thấy; chưa có tệp thì 0%', () => {
    expect(usagePercent(1024, 500 * GB)).toBe(1);
    expect(usagePercent(0, 500 * GB)).toBe(0);
  });

  it('không vượt 100%; ổ không báo dung lượng (null/0) thì không vẽ thanh', () => {
    expect(usagePercent(300 * GB, 100 * GB)).toBe(100);
    expect(usagePercent(5 * GB, null)).toBeNull();
    expect(usagePercent(5 * GB, 0)).toBeNull();
  });
});

describe('usageText', () => {
  it('dung lượng và số tệp theo kiểu Việt Nam', () => {
    expect(usageText(Math.round(12.4 * GB), 4310)).toBe('12,4 GB · 4.310 tệp');
    expect(usageText(0, 0)).toBe('0 B · 0 tệp');
  });
});
