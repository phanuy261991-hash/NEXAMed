import { describe, expect, it } from 'vitest';
import { labelForEntityType } from './entity-type-labels';

describe('labelForEntityType', () => {
  it('trả về nhãn tiếng Việt cho entityType đã biết, không lộ UUID/tên kỹ thuật', () => {
    expect(labelForEntityType('invoice')).toBe('Phiếu thu');
    expect(labelForEntityType('user_account')).toBe('Tài khoản người dùng');
    expect(labelForEntityType('vital_sign')).toBe('Sinh hiệu');
  });

  it('#109 — work_shift_assignment/doctor_availability/tenant_setting đã có nhãn (trước đó fallback ra mã kỹ thuật)', () => {
    expect(labelForEntityType('work_shift_assignment')).toBe('Đăng ký ca làm việc');
    expect(labelForEntityType('work_shift')).toBe('Ca làm việc');
    expect(labelForEntityType('doctor_availability')).toBe('Trạng thái làm việc bác sĩ');
    expect(labelForEntityType('tenant_setting')).toBe('Cấu hình phòng khám');
  });

  it('fallback về nguyên văn cho entityType chưa có trong map', () => {
    expect(labelForEntityType('unknown_entity')).toBe('unknown_entity');
  });
});
