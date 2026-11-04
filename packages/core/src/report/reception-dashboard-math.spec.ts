import { describe, expect, it } from 'vitest';
import { ageInYears, summarizeReceptionAppointments, type ReceptionAppointmentInput } from './reception-dashboard-math';

/** Mốc `HH:MM` giờ VN của ngày 2026-11-04 (UTC+7). */
const at = (hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 4, (h ?? 0) - 7, m ?? 0));
};
const TODAY = '2026-11-04';
const NOW = at('14:30');

function appt(id: string, hhmm: string, status: 'SCHEDULED' | 'CONVERTED', over: Partial<ReceptionAppointmentInput> = {}): ReceptionAppointmentInput {
  return { id, status, scheduledAt: at(hhmm), durationMinutes: 15, patientName: `BN ${id}`, doctorId: 'd1', doctorName: 'BS. Một', dob: null, ...over };
}

describe('ageInYears', () => {
  it('tuổi tròn năm: chưa đến sinh nhật thì trừ 1; sinh nhật đúng hôm nay thì đủ tuổi', () => {
    expect(ageInYears('1997-11-05', TODAY)).toBe(28);
    expect(ageInYears('1997-11-04', TODAY)).toBe(29);
    expect(ageInYears('2014-03-01', TODAY)).toBe(12);
  });
  it('sai định dạng hoặc sinh sau hôm nay → null', () => {
    expect(ageInYears('04/11/1997', TODAY)).toBeNull();
    expect(ageInYears('2030-01-01', TODAY)).toBeNull();
  });
});

describe('summarizeReceptionAppointments', () => {
  const list = [
    appt('a1', '09:00', 'CONVERTED'),
    appt('a2', '09:30', 'CONVERTED'),
    appt('a3', '14:00', 'SCHEDULED'),
    appt('a4', '14:45', 'SCHEDULED', { dob: '1997-02-02' }),
    appt('a5', '15:15', 'SCHEDULED', { doctorId: 'd2', doctorName: 'BS. Hai' }),
    appt('a6', '16:00', 'SCHEDULED', { doctorId: 'd2', doctorName: 'BS. Hai' }),
  ];

  it('đếm tổng, đã đến, chưa đến và chia theo giờ hẹn', () => {
    const r = summarizeReceptionAppointments(list, [], TODAY, NOW, 5);
    expect(r).toMatchObject({ total: 6, arrived: 2, notArrived: 4 });
    expect(r.hourly).toHaveLength(24);
    expect(r.hourly[9]).toEqual({ hour: 9, arrived: 2, notArrived: 0 });
    expect(r.hourly[14]).toEqual({ hour: 14, arrived: 0, notArrived: 2 });
    expect(r.hourly.reduce((s, h) => s + h.arrived + h.notArrived, 0)).toBe(r.total);
  });

  it('"sắp tới": chưa đến, từ 30 phút trước giờ hiện tại, sớm trước; lịch trễ quá 30 phút biến mất', () => {
    const r = summarizeReceptionAppointments(list, [], TODAY, NOW, 5);
    // a3 lúc 14:00 là đúng 30 phút trước 14:30 → còn hiện; không có lịch nào sớm hơn
    expect(r.upcoming.items.map((i) => i.appointmentId)).toEqual(['a3', 'a4', 'a5', 'a6']);
    expect(r.upcoming.items[1]).toMatchObject({ age: 29, doctorOnLeave: false });
    const later = summarizeReceptionAppointments(list, [], TODAY, at('14:31'), 5);
    expect(later.upcoming.items.map((i) => i.appointmentId)).toEqual(['a4', 'a5', 'a6']);
  });

  it('giới hạn danh sách và báo số còn lại', () => {
    const r = summarizeReceptionAppointments(list, [], TODAY, NOW, 2);
    expect(r.upcoming.items).toHaveLength(2);
    expect(r.upcoming.moreCount).toBe(2);
  });

  it('bác sĩ nghỉ: chỉ tính lịch CHƯA ĐẾN trùng khung nghỉ; mỗi bác sĩ một cảnh báo; lịch được đánh dấu doctorOnLeave', () => {
    const leaves = [{ userId: 'd2', startMinute: 14 * 60, endMinute: 18 * 60 }];
    const r = summarizeReceptionAppointments(list, leaves, TODAY, NOW, 5);
    expect(r.leaveAlerts).toEqual([{ doctorName: 'BS. Hai', startMinute: 840, endMinute: 1080, appointmentCount: 2 }]);
    expect(r.upcoming.items.filter((i) => i.doctorOnLeave).map((i) => i.appointmentId)).toEqual(['a5', 'a6']);
  });

  it('lịch đã đến của bác sĩ nghỉ không tạo cảnh báo; nghỉ ngoài giờ hẹn cũng không', () => {
    const converted = [appt('c1', '15:00', 'CONVERTED', { doctorId: 'd2', doctorName: 'BS. Hai' })];
    expect(summarizeReceptionAppointments(converted, [{ userId: 'd2', startMinute: 840, endMinute: 1080 }], TODAY, NOW, 5).leaveAlerts).toEqual([]);
    expect(summarizeReceptionAppointments(list, [{ userId: 'd2', startMinute: 420, endMinute: 660 }], TODAY, NOW, 5).leaveAlerts).toEqual([]);
  });

  it('ngày không có lịch → toàn số 0', () => {
    const r = summarizeReceptionAppointments([], [], TODAY, NOW, 5);
    expect(r).toMatchObject({ total: 0, arrived: 0, notArrived: 0, leaveAlerts: [], upcoming: { items: [], moreCount: 0 } });
  });
});
