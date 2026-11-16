import { describe, expect, it } from 'vitest';
import { THUMBNAIL_MAX_BYTES, THUMBNAIL_MAX_SIDE, isThumbnailable, planThumbnailSize } from './make-thumbnail';

describe('planThumbnailSize', () => {
  it('thu nhỏ ảnh lớn về cạnh dài tối đa, giữ tỉ lệ', () => {
    expect(planThumbnailSize(4000, 3000)).toEqual({ width: THUMBNAIL_MAX_SIDE, height: 240 });
    expect(planThumbnailSize(3000, 4000)).toEqual({ width: 240, height: THUMBNAIL_MAX_SIDE });
    expect(planThumbnailSize(2000, 2000)).toEqual({ width: THUMBNAIL_MAX_SIDE, height: THUMBNAIL_MAX_SIDE });
  });

  it('KHÔNG phóng to ảnh nhỏ hơn cạnh tối đa', () => {
    expect(planThumbnailSize(200, 100)).toEqual({ width: 200, height: 100 });
    expect(planThumbnailSize(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('ảnh rất dẹt vẫn có cạnh ngắn ≥ 1 điểm ảnh', () => {
    expect(planThumbnailSize(10000, 5)).toEqual({ width: THUMBNAIL_MAX_SIDE, height: 1 });
  });
});

describe('isThumbnailable', () => {
  it('chỉ ảnh JPG/PNG (không phân biệt hoa thường); PDF và DICOM thì không', () => {
    expect(isThumbnailable({ name: 'a.jpg' })).toBe(true);
    expect(isThumbnailable({ name: 'B.JPEG' })).toBe(true);
    expect(isThumbnailable({ name: 'c.PNG' })).toBe(true);
    expect(isThumbnailable({ name: 'd.pdf' })).toBe(false);
    expect(isThumbnailable({ name: 'e.dcm' })).toBe(false);
    expect(isThumbnailable({ name: 'khong-duoi' })).toBe(false);
  });

  it('hạn mức ảnh thu nhỏ khớp 200 KB của máy chủ', () => {
    expect(THUMBNAIL_MAX_BYTES).toBe(200 * 1024);
  });
});
