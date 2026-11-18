import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazyRoute } from './lazy-route';
import { idlePrefetchAllowed, preloadersFor, prefetchRoute, queueIdlePrefetch, registerRouteTable, resetRoutePrefetchForTest } from './route-prefetch';

const Wrapper = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
const Plain = () => null;
const page = () => null;

function makePages() {
  const fa = vi.fn(async () => ({ default: page }));
  const fb = vi.fn(async () => ({ default: page }));
  const fc = vi.fn(async () => ({ default: page }));
  const A = lazyRoute(fa);
  const B = lazyRoute(fb);
  const C = lazyRoute(fc);
  registerRouteTable([
    {
      path: '/',
      children: [
        { path: 'a', element: createElement(Wrapper, null, createElement(Wrapper, null, createElement(A))) },
        { path: 'b/:id', element: createElement(B) },
        { path: 'c', element: createElement(C) },
        { path: 'plain', element: createElement(Plain) },
      ],
    },
  ]);
  return { fa, fb, fc };
}

beforeEach(() => {
  resetRoutePrefetchForTest();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('preloadersFor', () => {
  it('tìm component lười kể cả khi bọc trong nhiều lớp (RequirePermissionRoute...), bỏ ?query và #hash', () => {
    makePages();
    expect(preloadersFor('/a')).toHaveLength(1);
    expect(preloadersFor('/a?tab=2#x')).toHaveLength(1);
    expect(preloadersFor('/b/123')).toHaveLength(1);
  });

  it('đường dẫn lạ hoặc trang không lười thì không có gì để tải trước', () => {
    makePages();
    expect(preloadersFor('/khong-co')).toEqual([]);
    expect(preloadersFor('/plain')).toEqual([]);
  });
});

describe('prefetchRoute', () => {
  it('tải chunk đúng một lần cho mỗi đường dẫn, gọi lại không tải thêm', async () => {
    const { fa, fb } = makePages();
    prefetchRoute('/a');
    prefetchRoute('/a?x=1');
    prefetchRoute('/a');
    await Promise.resolve();
    expect(fa).toHaveBeenCalledTimes(1);
    expect(fb).not.toHaveBeenCalled();
  });
});

describe('queueIdlePrefetch', () => {
  it('tải lần lượt từng chunk, mỗi lượt một cái, bắt đầu sau khoảng chờ', async () => {
    vi.useFakeTimers();
    const { fa, fb, fc } = makePages();
    const scheduler = (cb: () => void) => cb();
    queueIdlePrefetch('/a', scheduler);
    queueIdlePrefetch('/b/1', scheduler);
    queueIdlePrefetch('/c', scheduler);
    expect(fa).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2500);
    expect(fa).toHaveBeenCalledTimes(1);
    expect(fb).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(fb).toHaveBeenCalledTimes(1);
    expect(fc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(fc).toHaveBeenCalledTimes(1);
  });

  it('không xếp trùng và bỏ qua đường dẫn đã tải trước bằng rê chuột', async () => {
    vi.useFakeTimers();
    const { fa } = makePages();
    prefetchRoute('/a');
    queueIdlePrefetch('/a', (cb) => cb());
    queueIdlePrefetch('/a', (cb) => cb());
    await vi.advanceTimersByTimeAsync(5000);
    expect(fa).toHaveBeenCalledTimes(1);
  });

  it('bật tiết kiệm dữ liệu thì KHÔNG tải trước lúc rảnh', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const { fa } = makePages();
    expect(idlePrefetchAllowed()).toBe(false);
    queueIdlePrefetch('/a', (cb) => cb());
    await vi.advanceTimersByTimeAsync(5000);
    expect(fa).not.toHaveBeenCalled();
  });

  it('mạng 2G thì không tải trước, mạng tốt hoặc không rõ thì được', () => {
    vi.stubGlobal('navigator', { connection: { effectiveType: '2g' } });
    expect(idlePrefetchAllowed()).toBe(false);
    vi.stubGlobal('navigator', { connection: { effectiveType: '4g' } });
    expect(idlePrefetchAllowed()).toBe(true);
    vi.stubGlobal('navigator', {});
    expect(idlePrefetchAllowed()).toBe(true);
  });
});
