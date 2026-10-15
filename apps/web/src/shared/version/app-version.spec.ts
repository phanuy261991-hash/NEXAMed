import { describe, expect, it } from 'vitest';
import { formatDisplayVersion, formatFullVersion, isVersionMismatch } from './app-version';

describe('formatFullVersion', () => {
  it('ghép phiên bản với số bản dựng theo SemVer', () => {
    expect(formatFullVersion('0.9.0', '127')).toBe('0.9.0+127');
  });
  it('bản phát triển chỉ hiện số phiên bản', () => {
    expect(formatFullVersion('0.9.0', 'dev')).toBe('0.9.0');
    expect(formatFullVersion('0.9.0', '')).toBe('0.9.0');
  });
});

describe('formatDisplayVersion', () => {
  it('dạng hiển thị gọn: số phiên bản · bản dựng N', () => {
    expect(formatDisplayVersion('0.9.0', '127')).toBe('0.9.0 · bản dựng 127');
  });
  it('bản phát triển chỉ hiện số phiên bản', () => {
    expect(formatDisplayVersion('0.9.0', 'dev')).toBe('0.9.0');
    expect(formatDisplayVersion('0.9.0', '')).toBe('0.9.0');
  });
});

describe('isVersionMismatch', () => {
  const web = { version: '0.9.0', build: '127' };
  it('không lệch khi cùng phiên bản và cùng bản dựng', () => {
    expect(isVersionMismatch(web, { ...web })).toBe(false);
  });
  it('lệch khi khác số phiên bản', () => {
    expect(isVersionMismatch(web, { version: '0.10.0', build: '127' })).toBe(true);
  });
  it('lệch khi cùng số nhưng dựng lại (khác mã bản dựng)', () => {
    expect(isVersionMismatch(web, { version: '0.9.0', build: '128' })).toBe(true);
  });
});
