import { describe, expect, it, vi } from 'vitest';
import { lazyRoute } from './lazy-route';

const page = () => null;

describe('lazyRoute', () => {
  it('preload nạp chunk đúng MỘT lần dù gọi nhiều lần, kể cả gọi đồng thời', async () => {
    const factory = vi.fn(async () => ({ default: page }));
    const Page = lazyRoute(factory);
    await Promise.all([Page.preload(), Page.preload()]);
    await Page.preload();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('preload lỗi (mất mạng) KHÔNG ném lỗi ra ngoài và lần sau tự thử lại', async () => {
    let calls = 0;
    const factory = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('mất mạng');
      return { default: page };
    });
    const Page = lazyRoute(factory);
    await expect(Page.preload()).resolves.toBeUndefined();
    await Page.preload();
    expect(factory).toHaveBeenCalledTimes(2);
    await Page.preload();
    expect(factory).toHaveBeenCalledTimes(2); // đã nạp xong thì không nạp lại
  });

  it('chưa gọi preload thì không nạp gì (React.lazy chỉ nạp khi dựng)', () => {
    const factory = vi.fn(async () => ({ default: page }));
    lazyRoute(factory);
    expect(factory).not.toHaveBeenCalled();
  });

  it('component trả về là component lười của React (có $$typeof) và mang preload', () => {
    const Page = lazyRoute(async () => ({ default: page }));
    expect((Page as unknown as { $$typeof: symbol }).$$typeof.toString()).toContain('react.lazy');
    expect(typeof Page.preload).toBe('function');
  });
});
