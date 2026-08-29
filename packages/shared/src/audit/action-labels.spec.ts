import { describe, expect, it } from 'vitest';
import { isBreakGlassAction, labelForAuditAction } from './action-labels';

describe('labelForAuditAction', () => {
  it('trả về nhãn tiếng Việt cho action đã biết', () => {
    expect(labelForAuditAction('encounter.completed')).toBe('Hoàn tất khám');
    expect(labelForAuditAction('patient.merged')).toBe('Gộp hồ sơ trùng');
  });

  it('fallback về nguyên văn cho action chưa có trong map', () => {
    expect(labelForAuditAction('some_module.unknown_action')).toBe('some_module.unknown_action');
  });
});

describe('isBreakGlassAction', () => {
  it('nhận diện đúng 2 action break-glass', () => {
    expect(isBreakGlassAction('break_glass.request')).toBe(true);
    expect(isBreakGlassAction('break_glass.access')).toBe(true);
  });

  it('action khác trả về false', () => {
    expect(isBreakGlassAction('encounter.completed')).toBe(false);
  });
});
