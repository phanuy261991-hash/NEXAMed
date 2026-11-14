import { describe, expect, it } from 'vitest';
import { isShrinkableImage, planShrinkAttempts, shrunkFileName } from './shrink-image';

const MB = 1024 * 1024;

describe('isShrinkableImage', () => {
  it('chỉ ảnh JPG/PNG vượt giới hạn mới thu nhỏ; ảnh đúng cỡ, PDF và DICOM thì không', () => {
    expect(isShrinkableImage({ name: 'a.jpg', size: 21 * MB }, 15 * MB)).toBe(true);
    expect(isShrinkableImage({ name: 'a.PNG', size: 16 * MB }, 15 * MB)).toBe(true);
    expect(isShrinkableImage({ name: 'a.jpg', size: 15 * MB }, 15 * MB)).toBe(false);
    expect(isShrinkableImage({ name: 'a.pdf', size: 21 * MB }, 15 * MB)).toBe(false);
    expect(isShrinkableImage({ name: 'ct.dcm', size: 21 * MB }, 15 * MB)).toBe(false);
  });
});

describe('planShrinkAttempts', () => {
  it('lần đầu giới hạn cạnh dài 4096 và giữ tỉ lệ; ảnh nhỏ hơn 4096 giữ nguyên kích thước', () => {
    const [first] = planShrinkAttempts(8000, 6000);
    expect(first).toEqual({ width: 4096, height: 3072, quality: 0.85 });
    expect(planShrinkAttempts(3000, 2000)[0]).toEqual({ width: 3000, height: 2000, quality: 0.85 });
  });

  it('thử từ nhẹ đến mạnh: kích thước và chất lượng không bao giờ tăng, luôn có ít nhất một điểm ảnh', () => {
    const attempts = planShrinkAttempts(5000, 5000);
    expect(attempts.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < attempts.length; i++) {
      const prev = attempts[i - 1]!;
      const cur = attempts[i]!;
      expect(cur.width).toBeLessThanOrEqual(prev.width);
      expect(cur.quality).toBeLessThanOrEqual(prev.quality + 0.15);
    }
    expect(planShrinkAttempts(1, 1).every((a) => a.width >= 1 && a.height >= 1)).toBe(true);
  });
});

describe('shrunkFileName', () => {
  it('đổi đuôi sang .jpg, giữ phần tên', () => {
    expect(shrunkFileName('Phim panorama.PNG')).toBe('Phim panorama.jpg');
    expect(shrunkFileName('a.b.jpeg')).toBe('a.b.jpg');
    expect(shrunkFileName('khongduoi')).toBe('khongduoi.jpg');
  });
});
