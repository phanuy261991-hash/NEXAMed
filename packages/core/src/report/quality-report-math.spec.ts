import { describe, expect, it } from 'vitest';
import { interopBucket, summarizeInterop } from './quality-report-math';

describe('interopBucket', () => {
  it('quy trạng thái về đã gửi / chờ / lỗi; trạng thái lạ là other', () => {
    expect(['SENT', 'AMENDED', 'PENDING', 'FAILED', 'KHAC'].map(interopBucket)).toEqual(['sent', 'sent', 'pending', 'failed', 'other']);
  });
});

describe('summarizeInterop', () => {
  const counts = [
    { status: 'SENT', count: 6 },
    { status: 'AMENDED', count: 1 },
    { status: 'PENDING', count: 2 },
    { status: 'FAILED', count: 1 },
  ];
  const doctors = [
    { doctorId: 'a', doctorName: 'BS. An', status: 'SENT', count: 5 },
    { doctorId: 'a', doctorName: 'BS. An', status: 'FAILED', count: 1 },
    { doctorId: 'b', doctorName: 'BS. Bình', status: 'SENT', count: 2 },
    { doctorId: 'b', doctorName: 'BS. Bình', status: 'PENDING', count: 2 },
    { doctorId: 'c', doctorName: 'BS. Chi', status: 'SENT', count: 9 },
  ];
  it('tổng quan: đã gửi gồm cả bản đính chính, tỉ lệ trên tổng', () => {
    expect(summarizeInterop(counts, doctors).summary).toEqual({ total: 10, sent: 7, pending: 2, failed: 1, sentPercent: 70 });
  });
  it('bác sĩ xếp nhiều đơn chờ/lỗi nhất trước, hoà thì nhiều đơn hơn', () => {
    const rows = summarizeInterop(counts, doctors).byDoctor;
    expect(rows.map((r) => r.doctorName)).toEqual(['BS. Bình', 'BS. An', 'BS. Chi']);
    expect(rows[0]).toEqual({ doctorName: 'BS. Bình', total: 4, sent: 2, pending: 2, failed: 0 });
  });
  it('không có đơn nào thì tỉ lệ null; trạng thái lạ vẫn nằm trong tổng', () => {
    expect(summarizeInterop([], []).summary).toEqual({ total: 0, sent: 0, pending: 0, failed: 0, sentPercent: null });
    expect(summarizeInterop([{ status: 'KHAC', count: 3 }], []).summary.total).toBe(3);
  });
  it('đơn không có bác sĩ gom về một dòng', () => {
    const rows = summarizeInterop([], [{ doctorId: null, doctorName: 'Chưa rõ', status: 'PENDING', count: 1 }, { doctorId: null, doctorName: 'Chưa rõ', status: 'FAILED', count: 2 }]).byDoctor;
    expect(rows).toEqual([{ doctorName: 'Chưa rõ', total: 3, sent: 0, pending: 1, failed: 2 }]);
  });
});
