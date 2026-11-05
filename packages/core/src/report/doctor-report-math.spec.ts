import { describe, expect, it } from 'vitest';
import { itemsPerPrescription, shiftWorkMinutes, summarizeDoctorHours, summarizeDoctorOrderMix, summarizeDoctorPerformance, type DoctorStatRaw } from './doctor-report-math';

const stat = (over: Partial<DoctorStatRaw> & { doctorId: string; doctorName: string }): DoctorStatRaw => ({
  departmentId: null,
  departmentName: '',
  visits: 0,
  measured: 0,
  sumMinutes: 0,
  withCls: 0,
  clsInHouse: 0,
  clsExternal: 0,
  withPrescription: 0,
  prescriptionItems: 0,
  withFollowUp: 0,
  activeDays: 0,
  ...over,
});

describe('summarizeDoctorPerformance', () => {
  const stats = [
    stat({ doctorId: 'b', doctorName: 'BS. Bình', visits: 10, measured: 10, sumMinutes: 150, withCls: 5, withPrescription: 9, withFollowUp: 4 }),
    stat({ doctorId: 'a', doctorName: 'BS. An', visits: 20, measured: 10, sumMinutes: 130, withCls: 10, withPrescription: 18, withFollowUp: 6 }),
    stat({ doctorId: 'c', doctorName: 'BS. Châu', visits: 0 }),
    stat({ doctorId: 'd', doctorName: 'BS. Dũng', visits: 20, measured: 0, sumMinutes: 0 }),
  ];
  const revenue = new Map([['a', 3_000_000], ['b', 1_000_000], ['d', 3_000_000]]);

  it('xếp theo doanh thu giảm dần, bằng nhau thì theo số lượt rồi theo tên; bác sĩ không có lượt bị bỏ', () => {
    const { rows } = summarizeDoctorPerformance(stats, revenue);
    expect(rows.map((r) => [r.rank, r.doctorName])).toEqual([[1, 'BS. An'], [2, 'BS. Dũng'], [3, 'BS. Bình']]);
  });

  it('tính phút/lượt, doanh thu một lượt và các tỉ lệ', () => {
    const { rows } = summarizeDoctorPerformance(stats, revenue);
    const an = rows[0]!;
    expect(an).toMatchObject({ avgMinutes: 13, revenue: 3_000_000, revenuePerVisit: 150_000, clsPercent: 50, drugPercent: 90, followUpPercent: 30 });
    // Dũng không đo được thời gian khám → null, không phải 0.
    expect(rows[1]!.avgMinutes).toBeNull();
  });

  it('dòng cộng: bác sĩ có khám, lượt trung bình, phút trung bình theo số lượt đo được', () => {
    const { totals } = summarizeDoctorPerformance(stats, revenue);
    expect(totals).toMatchObject({ doctorCount: 3, visits: 50, visitsPerDoctor: 17, avgMinutes: 14, revenue: 7_000_000, revenuePerVisit: 140_000 });
    expect(totals.clsPercent).toBe(30);
  });

  it('không có dữ liệu → mọi tỉ lệ null, không chia cho 0', () => {
    const { rows, totals } = summarizeDoctorPerformance([], new Map());
    expect(rows).toEqual([]);
    expect(totals).toMatchObject({ doctorCount: 0, visits: 0, visitsPerDoctor: null, avgMinutes: null, revenuePerVisit: null, clsPercent: null });
  });
});

describe('summarizeDoctorOrderMix', () => {
  it('xếp theo số lượt, tính dòng thuốc trung bình và cộng đúng', () => {
    const { rows, totals } = summarizeDoctorOrderMix([
      stat({ doctorId: 'a', doctorName: 'BS. An', visits: 10, withPrescription: 8, prescriptionItems: 20, withCls: 4, clsInHouse: 5, clsExternal: 2, withFollowUp: 3 }),
      stat({ doctorId: 'b', doctorName: 'BS. Bình', visits: 30, withPrescription: 0, prescriptionItems: 0 }),
    ]);
    expect(rows.map((r) => r.doctorName)).toEqual(['BS. Bình', 'BS. An']);
    expect(rows[1]!.itemsPerPrescription).toBe(2.5);
    expect(rows[0]!.itemsPerPrescription).toBeNull();
    expect(totals).toMatchObject({ visits: 40, withPrescription: 8, prescriptionItems: 20, itemsPerPrescription: 2.5, withCls: 4, clsInHouse: 5, clsExternal: 2, withFollowUp: 3 });
  });
  it('itemsPerPrescription làm tròn một chữ số, null khi chưa có đơn', () => {
    expect(itemsPerPrescription(10, 3)).toBe(3.3);
    expect(itemsPerPrescription(5, 0)).toBeNull();
  });
});

describe('shiftWorkMinutes', () => {
  it('trừ giờ nghỉ, ưu tiên giờ công chuẩn, ca qua đêm cộng 24 giờ', () => {
    expect(shiftWorkMinutes('08:00', '12:00', null, null)).toBe(240);
    expect(shiftWorkMinutes('08:00', '17:00', 60, null)).toBe(480);
    expect(shiftWorkMinutes('08:00', '17:00', 60, 450)).toBe(450);
    expect(shiftWorkMinutes('22:00', '06:00', null, null)).toBe(480);
    expect(shiftWorkMinutes('08:00', '09:00', 120, null)).toBe(0);
  });
});

describe('summarizeDoctorHours', () => {
  const base = { departmentId: null, departmentName: '', leaveDays: 0, leaveMinutes: 0 };
  it('lượt/ngày làm, tỉ lệ sử dụng; bác sĩ không có ca → null và không làm phình tổng', () => {
    const { rows, totals } = summarizeDoctorHours([
      { ...base, doctorId: 'b', doctorName: 'BS. Bình', scheduledDays: 0, scheduledMinutes: 0, activeDays: 2, visits: 6, consultMinutes: 60 },
      { ...base, doctorId: 'a', doctorName: 'BS. An', scheduledDays: 10, scheduledMinutes: 4800, activeDays: 8, visits: 40, consultMinutes: 1200, leaveDays: 1, leaveMinutes: 240 },
    ]);
    expect(rows.map((r) => r.doctorName)).toEqual(['BS. An', 'BS. Bình']);
    expect(rows[0]).toMatchObject({ visitsPerActiveDay: 5, utilizationPercent: 25 });
    expect(rows[1]).toMatchObject({ visitsPerActiveDay: 3, utilizationPercent: null });
    expect(totals).toMatchObject({ doctorCount: 2, scheduledDays: 10, scheduledMinutes: 4800, leaveDays: 1, leaveMinutes: 240, activeDays: 10, visits: 46, consultMinutes: 1260, utilizationPercent: 25 });
  });
  it('bác sĩ chưa khám ngày nào → lượt/ngày null', () => {
    const { rows } = summarizeDoctorHours([{ ...base, doctorId: 'a', doctorName: 'BS. An', scheduledDays: 3, scheduledMinutes: 1440, activeDays: 0, visits: 0, consultMinutes: 0 }]);
    expect(rows[0]).toMatchObject({ visitsPerActiveDay: null, utilizationPercent: 0 });
  });
});
