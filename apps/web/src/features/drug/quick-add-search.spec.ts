import { describe, expect, it } from 'vitest';
import { isNoItemMatch } from './quick-add-search';

const settled = { query: 'khẩu trang n95', debouncedQuery: 'khẩu trang n95', isSuccess: true, isFetching: false, rawResultCount: 0 };

describe('isNoItemMatch', () => {
  it('tìm xong, đúng chuỗi đang gõ, không có kết quả → true', () => {
    expect(isNoItemMatch(settled)).toBe(true);
  });

  it('bỏ qua khoảng trắng đầu/cuối khi so chuỗi', () => {
    expect(isNoItemMatch({ ...settled, query: '  khẩu trang n95 ', debouncedQuery: 'khẩu trang n95' })).toBe(true);
  });

  it('ô trống → false', () => {
    expect(isNoItemMatch({ ...settled, query: '   ', debouncedQuery: '' })).toBe(false);
  });

  it('chuỗi đã gõ thêm nhưng kết quả còn của chuỗi cũ (chống giật chưa kịp) → false', () => {
    expect(isNoItemMatch({ ...settled, query: 'khẩu trang n95 3m' })).toBe(false);
  });

  it('đang tải lại hoặc chưa thành công → false', () => {
    expect(isNoItemMatch({ ...settled, isFetching: true })).toBe(false);
    expect(isNoItemMatch({ ...settled, isSuccess: false })).toBe(false);
  });

  it('có mặt hàng khớp (kể cả mặt hàng sẽ bị ẩn vì đã có trong đơn) → false', () => {
    expect(isNoItemMatch({ ...settled, rawResultCount: 1 })).toBe(false);
  });
});
