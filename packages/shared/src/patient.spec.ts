import { describe, expect, it } from 'vitest';
import { calculateAgeYears } from './patient';

describe('calculateAgeYears', () => {
  it('sinh nhật đã qua trong năm → đủ tuổi tròn năm', () => {
    expect(calculateAgeYears('2008-09-17', new Date('2026-09-18T12:00:00Z'))).toBe(18);
  });

  it('sinh nhật đúng hôm nay → tính đủ tuổi (theo lịch Việt Nam)', () => {
    expect(calculateAgeYears('2008-09-17', new Date('2026-09-17T10:00:00Z'))).toBe(18);
  });

  it('sinh nhật chưa tới trong năm → chưa đủ tuổi tròn năm', () => {
    expect(calculateAgeYears('2008-09-18', new Date('2026-09-17T10:00:00Z'))).toBe(17);
  });

  it('BUG THẬT đã sửa (17/09/2026): không lệch ngày quanh khung 00:00–07:00 giờ VN — thời điểm UTC' +
    ' còn là "hôm qua" nhưng giờ Việt Nam đã sang ngày sinh nhật vẫn phải tính ĐỦ tuổi', () => {
    // 2026-09-17T00:30:00+07:00 = 2026-09-16T17:30:00Z — UTC vẫn là 16/09, giờ VN đã là 17/09.
    const nowJustAfterMidnightVn = new Date('2026-09-16T17:30:00Z');
    expect(calculateAgeYears('2008-09-17', nowJustAfterMidnightVn)).toBe(18);
  });

  it('sinh vào giờ UTC muộn nhưng vẫn cùng ngày lịch Việt Nam — không lùi ngày sinh', () => {
    // '2008-09-17' parse thành 2008-09-17T00:00:00Z, +7h vẫn là ngày 17 theo lịch VN.
    expect(calculateAgeYears('2008-09-17', new Date('2026-09-17T10:00:00Z'))).toBe(18);
  });
});
