import { describe, expect, it } from 'vitest';
import { fitPreviewZoom } from './print-preview-zoom';

// A4 rộng 210mm ≈ 793,7px ở 100%.
describe('fitPreviewZoom', () => {
  it('khung rộng thì giữ mức mặc định, không phóng quá', () => {
    expect(fitPreviewZoom(1200, 210, 60)).toBe(60);
  });
  it('khung hẹp thì chọn bậc lớn nhất còn vừa: 520px rộng → A4 vừa 65% → bậc 60', () => {
    expect(fitPreviewZoom(520, 210, 75)).toBe(60);
  });
  it('khung ~340px (1280px, panel hẹp): A4 vừa 42% → bậc 40', () => {
    expect(fitPreviewZoom(340, 210, 60)).toBe(40);
  });
  it('khung quá hẹp không xuống dưới bậc nhỏ nhất (30)', () => {
    expect(fitPreviewZoom(100, 210, 60)).toBe(30);
  });
  it('chưa đo được (0/NaN) thì dùng mức mặc định', () => {
    expect(fitPreviewZoom(0, 210, 60)).toBe(60);
    expect(fitPreviewZoom(Number.NaN, 210, 60)).toBe(60);
  });
  it('khổ tem nhãn có mức mặc định 300% vượt các bậc: khung rộng vẫn giữ 300', () => {
    expect(fitPreviewZoom(900, 35, 300)).toBe(300);
  });
  it('giấy K80 (80mm) ở khung 330px: vừa 109% → bậc 100 (mặc định 100)', () => {
    expect(fitPreviewZoom(330, 80, 100)).toBe(100);
  });
});
