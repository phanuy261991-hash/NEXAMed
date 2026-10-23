import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyAppError, logAppError } from './app-error';

describe('classifyAppError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x.vn/assets/PatientListPage-AbC123.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Loading chunk 17 failed.',
    'Loading CSS chunk 4 failed.',
    'Unable to preload CSS for /assets/index-xyz.css',
  ])('coi là phần mềm vừa cập nhật (outdated): %s', (message) => {
    expect(classifyAppError(new TypeError(message))).toBe('outdated');
  });

  it('nhận ra theo tên lỗi ChunkLoadError', () => {
    const err = new Error('boom');
    err.name = 'ChunkLoadError';
    expect(classifyAppError(err)).toBe('outdated');
  });

  it('lỗi thường, lỗi lạ và giá trị không phải Error → unexpected', () => {
    expect(classifyAppError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe('unexpected');
    expect(classifyAppError(new RangeError('Invalid array length'))).toBe('unexpected');
    expect(classifyAppError(undefined)).toBe('unexpected');
    expect(classifyAppError(null)).toBe('unexpected');
    expect(classifyAppError({ status: 500, statusText: 'Internal Server Error' })).toBe('unexpected');
    expect(classifyAppError(42)).toBe('unexpected');
  });

  it('chuỗi thuần cũng được nhận ra', () => {
    expect(classifyAppError('Failed to fetch dynamically imported module')).toBe('outdated');
    expect(classifyAppError('lỗi gì đó')).toBe('unexpected');
  });
});

describe('logAppError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('chỉ ghi tên + thông điệp, KHÔNG ghi đối tượng lỗi/ngăn xếp', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = new Error('hỏng rồi');
    logAppError(err);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual(['[app-error]', 'Error', 'hỏng rồi']);
    expect(spy.mock.calls[0]).not.toContain(err);
  });

  it('giá trị không phải Error vẫn ghi được', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logAppError('chuỗi thô');
    expect(spy.mock.calls[0]).toEqual(['[app-error]', 'string', 'chuỗi thô']);
  });
});
