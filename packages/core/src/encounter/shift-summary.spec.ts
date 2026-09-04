import { describe, expect, it } from 'vitest';
import { computeShiftSummary } from './shift-summary';

describe('computeShiftSummary', () => {
  it('làm tròn thời gian khám trung bình về phút, làm tròn nửa lên', () => {
    const result = computeShiftSummary({
      calledCount: 14,
      completedCount: 12,
      cancelledCount: 1,
      prescriptionCount: 9,
      completedDurationsMs: [15 * 60_000, 17 * 60_000], // trung bình đúng 16 phút
    });
    expect(result.avgConsultMinutes).toBe(16);
  });

  it('làm tròn nửa phút lên (Math.round, không phải cắt bớt)', () => {
    const result = computeShiftSummary({
      calledCount: 1,
      completedCount: 1,
      cancelledCount: 0,
      prescriptionCount: 0,
      completedDurationsMs: [90_000], // 1.5 phút -> 2, không phải 1
    });
    expect(result.avgConsultMinutes).toBe(2);
  });

  it('trả null (không phải 0/NaN) khi chưa có ca nào hoàn tất hôm nay', () => {
    const result = computeShiftSummary({
      calledCount: 3,
      completedCount: 0,
      cancelledCount: 0,
      prescriptionCount: 0,
      completedDurationsMs: [],
    });
    expect(result.avgConsultMinutes).toBeNull();
  });

  it('giữ nguyên các số đếm khác không đổi', () => {
    const result = computeShiftSummary({
      calledCount: 14,
      completedCount: 12,
      cancelledCount: 1,
      prescriptionCount: 9,
      completedDurationsMs: [10 * 60_000],
    });
    expect(result.calledCount).toBe(14);
    expect(result.completedCount).toBe(12);
    expect(result.cancelledCount).toBe(1);
    expect(result.prescriptionCount).toBe(9);
  });
});
