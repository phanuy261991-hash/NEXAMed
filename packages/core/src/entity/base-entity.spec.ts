import { describe, expect, it } from 'vitest';
import { isSigned } from './base-entity';

describe('isSigned', () => {
  it('chưa ký (signedAt null) thì false', () => {
    expect(isSigned({ signedAt: null })).toBe(false);
  });

  it('đã ký (signedAt có giá trị) thì true', () => {
    expect(isSigned({ signedAt: new Date('2026-08-10T10:00:00.000Z') })).toBe(true);
  });
});
