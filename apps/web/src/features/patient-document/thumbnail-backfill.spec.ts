import { beforeEach, describe, expect, it } from 'vitest';
import { THUMBNAIL_MAX_SIDE } from './make-thumbnail';
import { needsThumbnailBackfill, queueThumbnailBackfill, resetThumbnailBackfillForTest } from './thumbnail-backfill';

describe('needsThumbnailBackfill', () => {
  const image = { kind: 'image' as const, thumbnailUrl: null };

  it('ảnh lớn chưa có ảnh thu nhỏ thì cần bù', () => {
    expect(needsThumbnailBackfill(image, 4000, 3000)).toBe(true);
    expect(needsThumbnailBackfill(image, THUMBNAIL_MAX_SIDE + 1, 10)).toBe(true);
  });

  it('đã có ảnh thu nhỏ, hoặc ảnh đã nhỏ sẵn, hoặc không phải ảnh thì không bù', () => {
    expect(needsThumbnailBackfill({ kind: 'image', thumbnailUrl: '/api/v1/files/x' }, 4000, 3000)).toBe(false);
    expect(needsThumbnailBackfill(image, THUMBNAIL_MAX_SIDE, THUMBNAIL_MAX_SIDE)).toBe(false);
    expect(needsThumbnailBackfill({ kind: 'pdf', thumbnailUrl: null }, 4000, 3000)).toBe(false);
    expect(needsThumbnailBackfill({ kind: 'dicom', thumbnailUrl: null }, 4000, 3000)).toBe(false);
  });
});

describe('queueThumbnailBackfill', () => {
  beforeEach(() => resetThumbnailBackfillForTest());

  it('chạy lần lượt từng việc, không chồng nhau', async () => {
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const job = (name: string) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      log.push(`bắt đầu ${name}`);
      await new Promise((r) => setTimeout(r, 5));
      log.push(`xong ${name}`);
      active -= 1;
    };
    queueThumbnailBackfill('a', job('a'));
    queueThumbnailBackfill('b', job('b'));
    queueThumbnailBackfill('c', job('c'));
    await new Promise((r) => setTimeout(r, 60));
    expect(maxActive).toBe(1);
    expect(log).toEqual(['bắt đầu a', 'xong a', 'bắt đầu b', 'xong b', 'bắt đầu c', 'xong c']);
  });

  it('mỗi tệp chỉ thử MỘT lần trong phiên', async () => {
    let runs = 0;
    const job = async () => {
      runs += 1;
    };
    expect(queueThumbnailBackfill('doc-1', job)).toBe(true);
    expect(queueThumbnailBackfill('doc-1', job)).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(runs).toBe(1);
  });

  it('một việc lỗi không làm dừng hàng đợi', async () => {
    const done: string[] = [];
    queueThumbnailBackfill('x', async () => {
      throw new Error('mạng đứt');
    });
    queueThumbnailBackfill('y', async () => {
      done.push('y');
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toEqual(['y']);
  });
});
