import { describe, expect, it } from 'vitest';
import { isBreakGlassAction, labelForAuditAction } from './action-labels';

describe('labelForAuditAction', () => {
  it('trả về nhãn tiếng Việt cho action đã biết', () => {
    expect(labelForAuditAction('encounter.completed')).toBe('Hoàn tất khám');
    expect(labelForAuditAction('patient.merged')).toBe('Gộp hồ sơ trùng');
  });

  it('#109 — action của work_shift/work_shift_assignment/doctor_availability đã có nhãn (trước đó fallback ra mã kỹ thuật)', () => {
    expect(labelForAuditAction('work_shift_assignment.bulk_created')).toBe('Đăng ký ca hàng loạt');
    expect(labelForAuditAction('work_shift.created')).toBe('Thêm ca làm việc');
    expect(labelForAuditAction('doctor_availability.ended')).toBe('Đóng ca làm việc');
    expect(labelForAuditAction('appointment.no_show')).toBe('Đánh dấu không đến');
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
