import { describe, expect, it } from 'vitest';
import { formatHistoryResult } from './software-update-view';

describe('formatHistoryResult', () => {
  it('có bản mới thì nêu số phiên bản', () => {
    expect(formatHistoryResult({ result: 'update_available', latestVersion: '0.10.0' })).toBe('Có bản 0.10.0');
    expect(formatHistoryResult({ result: 'update_available', latestVersion: null })).toBe('Có bản mới');
  });

  it('lỗi và mới nhất có chữ riêng', () => {
    expect(formatHistoryResult({ result: 'error', latestVersion: null })).toBe('Lỗi kết nối');
    expect(formatHistoryResult({ result: 'up_to_date', latestVersion: null })).toBe('Đang là bản mới nhất');
  });
});
