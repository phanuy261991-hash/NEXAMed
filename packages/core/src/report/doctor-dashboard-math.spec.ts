import { describe, expect, it } from 'vitest';
import { averagePerActiveDay, minutesBetween, roundedAverage, summarizeDoctorEncounters, vietnamHour, type DoctorEncounterInput } from './doctor-dashboard-math';

const NOW = new Date('2026-11-04T07:32:00Z'); // 14:32 giờ VN
const at = (hhmmVn: string) => {
  const [h, m] = hhmmVn.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 4, h! - 7, m!));
};
let seq = 0;
const row = (status: DoctorEncounterInput['status'], checkedIn: string, extra: Partial<DoctorEncounterInput> = {}): DoctorEncounterInput => ({
  encounterId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  status,
  checkedInAt: at(checkedIn),
  startedAt: null,
  completedAt: null,
  patientName: `BN ${seq}`,
  patientCode: `BN${seq}`,
  dob: null,
  ...extra,
});

describe('minutesBetween / roundedAverage / averagePerActiveDay / vietnamHour', () => {
  it('làm tròn xuống, không âm', () => {
    expect(minutesBetween(at('14:00'), at('14:14'))).toBe(14);
    expect(minutesBetween(new Date('2026-11-04T07:00:00Z'), new Date('2026-11-04T07:00:59Z'))).toBe(0);
    expect(minutesBetween(at('15:00'), at('14:00'))).toBe(0);
  });
  it('trung bình làm tròn half-up; rỗng → null', () => {
    expect(roundedAverage([10, 11])).toBe(11);
    expect(roundedAverage([10, 12, 12])).toBe(11);
    expect(roundedAverage([])).toBeNull();
  });
  it('trung bình mỗi ngày CÓ khám: bỏ ngày 0 lượt', () => {
    expect(averagePerActiveDay([10, 0, 14, 0, 0, 12, 0])).toBe(12);
    expect(averagePerActiveDay([0, 0])).toBeNull();
  });
  it('giờ VN theo lệch +7 cố định, qua nửa đêm UTC', () => {
    expect(vietnamHour(new Date('2026-11-04T16:30:00Z'))).toBe(23);
    expect(vietnamHour(new Date('2026-11-04T17:00:00Z'))).toBe(0);
  });
});

describe('summarizeDoctorEncounters', () => {
  const rows: DoctorEncounterInput[] = [
    row('COMPLETED', '07:10', { startedAt: at('07:15'), completedAt: at('07:25') }),
    row('COMPLETED', '08:00', { startedAt: at('08:05'), completedAt: at('08:17') }),
    row('COMPLETED', '10:00'), // thiếu giờ → không vào trung bình
    row('IN_CONSULTATION', '14:00', { startedAt: at('14:24'), patientName: 'Nguyễn Thị Lan' }),
    row('IN_CONSULTATION', '14:10', { startedAt: at('14:30'), patientName: 'Người khám sau' }),
    row('CHECKED_IN', '14:18', { dob: '1997-02-10', patientName: 'Đỗ Thanh Mai' }),
    row('CHECKED_IN', '14:18', { dob: null, patientName: 'Cùng giờ' }),
    row('CHECKED_IN', '14:30', { patientName: 'Chờ sau' }),
  ];
  const s = summarizeDoctorEncounters(rows, NOW, '2026-11-04', 2);

  it('đếm theo trạng thái', () => {
    expect(s.total).toBe(8);
    expect(s.waiting.count).toBe(3);
    expect(s.inProgress.count).toBe(2);
    expect(s.done.count).toBe(3);
  });
  it('người chờ lâu nhất và danh sách chờ (lâu nhất đứng đầu, cắt theo giới hạn)', () => {
    expect(s.waiting.longestWaitMinutes).toBe(14);
    expect(s.waitingList.items.map((i) => i.patientName)).toEqual(['Đỗ Thanh Mai', 'Cùng giờ']);
    expect(s.waitingList.items[0]).toMatchObject({ waitMinutes: 14, age: 29 });
    expect(s.waitingList.items[1]!.age).toBeNull();
    expect(s.waitingList.moreCount).toBe(1);
  });
  it('đang khám lấy bệnh nhân bắt đầu sớm nhất, tính số phút', () => {
    expect(s.inProgress.patientName).toBe('Nguyễn Thị Lan');
    expect(s.inProgress.minutes).toBe(8);
  });
  it('thời gian khám trung bình chỉ tính lượt có đủ giờ bắt đầu và hoàn tất', () => {
    expect(s.done.averageMinutes).toBe(11); // (10 + 12) / 2
  });
  it('theo giờ: đủ 24 giờ, đếm theo giờ nhận', () => {
    expect(s.hourly).toHaveLength(24);
    expect(s.hourly[7]!.count).toBe(1);
    expect(s.hourly[14]!.count).toBe(5);
    expect(s.hourly.reduce((t, h) => t + h.count, 0)).toBe(8);
  });
  it('không có lượt nào → số 0 và null, không lỗi', () => {
    const empty = summarizeDoctorEncounters([], NOW, '2026-11-04', 5);
    expect(empty).toMatchObject({ total: 0, waiting: { count: 0, longestWaitMinutes: null }, inProgress: { count: 0, patientName: null, minutes: null }, done: { count: 0, averageMinutes: null } });
    expect(empty.waitingList).toEqual({ items: [], moreCount: 0 });
  });
});
