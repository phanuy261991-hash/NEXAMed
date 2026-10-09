import { describe, expect, it } from 'vitest';
import { selectGridDoctors, type GridLeaveBlock } from './schedule-grid.utils';

const doctors = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const morning = { startTime: '07:30', endTime: '11:30' };
const wholeDayLeave: GridLeaveBlock = { status: 'APPROVED', startMinute: 0, endMinute: 1440, isWholeDay: true, workShiftName: null };

function select(over: Partial<Parameters<typeof selectGridDoctors<{ id: string }>>[0]> = {}) {
  return selectGridDoctors({ doctors, shiftsByDoctor: {}, leaveByDoctor: {}, appointments: [], showUnregistered: false, ...over });
}

describe('selectGridDoctors', () => {
  it('ngày không bác sĩ nào đăng ký ca → hiện tất cả như hiện nay, không có công tắc', () => {
    const r = select();
    expect(r.doctors.map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(r.hiddenUnregisteredCount).toBe(0);
    expect(r.dayUsesShifts).toBe(false);
  });

  it('có bác sĩ đăng ký ca → ẩn người chưa đăng ký ca và đếm số bị ẩn', () => {
    const r = select({ shiftsByDoctor: { a: [morning] } });
    expect(r.doctors.map((d) => d.id)).toEqual(['a']);
    expect(r.hiddenUnregisteredCount).toBe(2);
  });

  it('bật công tắc → hiện thêm bác sĩ chưa đăng ký ca', () => {
    const r = select({ shiftsByDoctor: { a: [morning] }, showUnregistered: true });
    expect(r.doctors.map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(r.hiddenUnregisteredCount).toBe(0);
  });

  it('bác sĩ chưa đăng ký ca nhưng còn lịch hẹn vẫn hiện; lịch đã huỷ/dời thì không giữ cột', () => {
    const r = select({
      shiftsByDoctor: { a: [morning] },
      appointments: [
        { doctorId: 'b', status: 'SCHEDULED' },
        { doctorId: 'c', status: 'CANCELLED' },
      ],
    });
    expect(r.doctors.map((d) => d.id)).toEqual(['a', 'b']);
    expect(r.hiddenUnregisteredCount).toBe(1);
  });

  it('nghỉ cả ngày đã duyệt và hết lịch hẹn → ẩn; còn lịch hẹn → vẫn hiện để xử lý', () => {
    const base = { shiftsByDoctor: { a: [morning], b: [morning] }, leaveByDoctor: { a: [wholeDayLeave] } };
    expect(select(base).doctors.map((d) => d.id)).toEqual(['b']);
    expect(select({ ...base, appointments: [{ doctorId: 'a', status: 'SCHEDULED' }] }).doctors.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('nghỉ chờ duyệt hoặc chỉ một ca → vẫn hiện', () => {
    const afternoon = { startTime: '13:30', endTime: '17:00' };
    const pending = { ...wholeDayLeave, status: 'PENDING' as const };
    expect(select({ shiftsByDoctor: { a: [morning] }, leaveByDoctor: { a: [pending] } }).doctors.map((d) => d.id)).toEqual(['a']);
    const morningOnly: GridLeaveBlock = { status: 'APPROVED', startMinute: 450, endMinute: 690, isWholeDay: false, workShiftName: 'Ca sáng' };
    expect(select({ shiftsByDoctor: { a: [morning, afternoon] }, leaveByDoctor: { a: [morningOnly] } }).doctors.map((d) => d.id)).toEqual(['a']);
  });
});
