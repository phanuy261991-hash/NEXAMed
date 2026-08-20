import { describe, expect, it } from 'vitest';
import { resolveAccountActiveState } from './employment-status';
import { AccountCannotReactivateWhileResignedError } from '../errors/user-account-errors';

describe('resolveAccountActiveState', () => {
  it('không có trạng thái làm việc → dùng giá trị client gửi, không gửi thì dùng fallback', () => {
    expect(resolveAccountActiveState(null, undefined, true)).toBe(true);
    expect(resolveAccountActiveState(null, false, true)).toBe(false);
  });

  it('trạng thái làm việc không tự-vô-hiệu-hoá → dùng giá trị client gửi, không gửi thì dùng fallback', () => {
    expect(resolveAccountActiveState({ deactivatesAccount: false }, undefined, true)).toBe(true);
    expect(resolveAccountActiveState({ deactivatesAccount: false }, undefined, false)).toBe(false);
    expect(resolveAccountActiveState({ deactivatesAccount: false }, true, false)).toBe(true);
  });

  it('trạng thái tự-vô-hiệu-hoá + không yêu cầu isActive:true tường minh → ép false lặng lẽ', () => {
    expect(resolveAccountActiveState({ deactivatesAccount: true }, undefined, true)).toBe(false);
    expect(resolveAccountActiveState({ deactivatesAccount: true }, false, true)).toBe(false);
  });

  it('trạng thái tự-vô-hiệu-hoá + client cố ép isActive:true → ném lỗi', () => {
    expect(() => resolveAccountActiveState({ deactivatesAccount: true }, true, true)).toThrow(
      AccountCannotReactivateWhileResignedError,
    );
  });
});
