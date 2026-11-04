import { describe, expect, it } from 'vitest';
import { appointmentHref, buildHourlyAppointments, leaveAlertSentence, leaveAlertsTotal, upcomingSubtitle, withDoctorTitle } from './reception-dashboard-model';

describe('withDoctorTitle', () => {
  it('thêm "BS." khi chưa có, giữ nguyên khi đã có', () => {
    expect(withDoctorTitle('Phạm Quốc Đạt')).toBe('BS. Phạm Quốc Đạt');
    expect(withDoctorTitle('BS. Lê Thu Vân')).toBe('BS. Lê Thu Vân');
    expect(withDoctorTitle('Bác sĩ Trần Hoà')).toBe('Bác sĩ Trần Hoà');
  });
});

describe('leaveAlertSentence', () => {
  it('nghỉ một khoảng: nêu giờ bắt đầu - kết thúc và số lịch cần đổi', () => {
    expect(leaveAlertSentence({ doctorName: 'Phạm Quốc Đạt', startMinute: 840, endMinute: 1080, appointmentCount: 2 })).toBe('BS. Phạm Quốc Đạt nghỉ phép từ 14:00 đến 18:00 hôm nay. 2 lịch hẹn cần đổi bác sĩ.');
  });
  it('nghỉ cả ngày', () => {
    expect(leaveAlertSentence({ doctorName: 'A', startMinute: 0, endMinute: 1440, appointmentCount: 1 })).toBe('BS. A nghỉ phép cả ngày hôm nay. 1 lịch hẹn cần đổi bác sĩ.');
  });
  it('tổng số lịch của nhiều cảnh báo', () => {
    expect(leaveAlertsTotal([{ doctorName: 'A', startMinute: 0, endMinute: 60, appointmentCount: 2 }, { doctorName: 'B', startMinute: 0, endMinute: 60, appointmentCount: 3 }])).toBe(5);
    expect(leaveAlertsTotal([])).toBe(0);
  });
});

describe('appointmentHref', () => {
  it('mở Lịch hẹn đúng ngày và lịch; chế độ dời thêm mode', () => {
    expect(appointmentHref('2026-11-04', 'abc')).toBe('/appointments?date=2026-11-04&appointmentId=abc');
    expect(appointmentHref('2026-11-04', 'abc', 'reschedule')).toBe('/appointments?date=2026-11-04&appointmentId=abc&mode=reschedule');
  });
});

describe('buildHourlyAppointments', () => {
  const hourly = (e: Record<number, [number, number]>) => Array.from({ length: 24 }, (_, hour) => ({ hour, arrived: e[hour]?.[0] ?? 0, notArrived: e[hour]?.[1] ?? 0 }));

  it('mặc định 07–18; đoạn dưới đã đến, đoạn trên chưa đến; đánh dấu giờ hiện tại', () => {
    const chart = buildHourlyAppointments(hourly({ 9: [3, 0], 14: [1, 2] }), 14);
    expect(chart.items).toHaveLength(12);
    expect(chart.items[0]!.label).toBe('07');
    expect(chart.items[7]!.segments).toEqual([
      { value: 1, className: 'bg-emerald-500' },
      { value: 2, className: 'bg-amber-300' },
    ]);
    expect(chart.currentIndex).toBe(7);
    expect(chart.total).toBe(6);
  });

  it('mở rộng khi có lịch ngoài khoảng; giờ hiện tại ngoài khoảng hiển thị → null', () => {
    const chart = buildHourlyAppointments(hourly({ 6: [1, 0], 20: [0, 1] }), 23);
    expect(chart.items[0]!.label).toBe('06');
    expect(chart.items.at(-1)!.label).toBe('20');
    expect(chart.currentIndex).toBeNull();
  });
});

describe('upcomingSubtitle', () => {
  it('có tuổi thì ghi "N tuổi ·", chưa có hồ sơ thì chỉ bác sĩ', () => {
    const base = { appointmentId: 'x', scheduledAt: '2026-11-04T07:00:00.000Z', patientName: 'A', doctorName: 'Lê Thu Vân', doctorOnLeave: false };
    expect(upcomingSubtitle({ ...base, age: 29 })).toBe('29 tuổi · BS. Lê Thu Vân');
    expect(upcomingSubtitle({ ...base, age: null })).toBe('BS. Lê Thu Vân');
  });
});
