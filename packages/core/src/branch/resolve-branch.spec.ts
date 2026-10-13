import { describe, expect, it } from 'vitest';
import { resolveBranchId } from './resolve-branch';

describe('resolveBranchId', () => {
  it('không được gán chi nhánh nào → null', () => {
    expect(resolveBranchId([], { lastBranchId: 'a' })).toBeNull();
  });

  it('đúng 1 chi nhánh → chọn luôn, bất kể ứng viên', () => {
    expect(resolveBranchId(['a'], {})).toBe('a');
    expect(resolveBranchId(['a'], { sessionBranchId: 'x', lastBranchId: 'y' })).toBe('a');
  });

  it('từ 2 chi nhánh: chi nhánh của phiên thắng chi nhánh nhớ lần trước', () => {
    expect(resolveBranchId(['a', 'b'], { sessionBranchId: 'b', lastBranchId: 'a' })).toBe('b');
  });

  it('từ 2 chi nhánh: phiên không còn hợp lệ thì dùng chi nhánh nhớ lần trước', () => {
    expect(resolveBranchId(['a', 'b'], { sessionBranchId: 'x', lastBranchId: 'a' })).toBe('a');
  });

  it('từ 2 chi nhánh: không ứng viên nào còn hợp lệ → null (phải chọn)', () => {
    expect(resolveBranchId(['a', 'b'], { sessionBranchId: null, lastBranchId: 'x' })).toBeNull();
    expect(resolveBranchId(['a', 'b'], {})).toBeNull();
  });
});
