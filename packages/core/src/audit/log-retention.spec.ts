import { describe, expect, it } from 'vitest';
import { isSystemLogEntityType, systemLogEntityTypes } from './log-retention';

describe('isSystemLogEntityType', () => {
  it('nhận diện đúng entityType thuộc System Log', () => {
    expect(isSystemLogEntityType('user_account')).toBe(true);
    expect(isSystemLogEntityType('reference_catalog')).toBe(true);
    expect(isSystemLogEntityType('drug')).toBe(true);
  });

  it('log nghiệp vụ (gắn hồ sơ bệnh án) không thuộc System Log', () => {
    expect(isSystemLogEntityType('patient')).toBe(false);
    expect(isSystemLogEntityType('encounter')).toBe(false);
    expect(isSystemLogEntityType('appointment')).toBe(false);
    expect(isSystemLogEntityType('invoice')).toBe(false);
    expect(isSystemLogEntityType('vital_sign')).toBe(false);
  });

  it('entityType lạ (chưa biết) mặc định AN TOÀN — không bị coi là System Log', () => {
    expect(isSystemLogEntityType('some_future_entity')).toBe(false);
  });

  it('systemLogEntityTypes() trả về mảng khớp isSystemLogEntityType', () => {
    for (const t of systemLogEntityTypes()) {
      expect(isSystemLogEntityType(t)).toBe(true);
    }
  });
});
