import { describe, expect, it, vi } from 'vitest';
import { loadAllByCursor } from './load-all-pages';

const page = (n: number, next: string | null) => ({ items: Array.from({ length: n }, (_, i) => i), nextCursor: next });

describe('loadAllByCursor', () => {
  it('một trang duy nhất: trả đúng trang đó, không gọi thêm', async () => {
    const fetchPage = vi.fn(async () => page(3, null));
    const r = await loadAllByCursor(fetchPage, 100);
    expect(r.pages).toHaveLength(1);
    expect(r.capped).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(undefined);
  });

  it('nhiều trang: đi theo con trỏ tới hết, truyền đúng con trỏ từng lần', async () => {
    const fetchPage = vi.fn(async (cursor: string | undefined) => (cursor === undefined ? page(2, 'a') : cursor === 'a' ? page(2, 'b') : page(1, null)));
    const r = await loadAllByCursor(fetchPage, 100);
    expect(r.pages.map((p) => p.items.length)).toEqual([2, 2, 1]);
    expect(r.capped).toBe(false);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([undefined, 'a', 'b']);
  });

  it('dừng khi đủ số dòng tối đa và báo capped', async () => {
    const fetchPage = vi.fn(async () => page(4, 'tiep'));
    const r = await loadAllByCursor(fetchPage, 10);
    expect(r.capped).toBe(true);
    expect(r.pages.reduce((s, p) => s + p.items.length, 0)).toBeGreaterThanOrEqual(10);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('lỗi tải một trang thì ném lỗi, không in dang dở', async () => {
    const fetchPage = vi.fn(async (cursor: string | undefined) => {
      if (cursor === undefined) return page(2, 'a');
      throw new Error('mất mạng');
    });
    await expect(loadAllByCursor(fetchPage, 100)).rejects.toThrow('mất mạng');
  });
});
