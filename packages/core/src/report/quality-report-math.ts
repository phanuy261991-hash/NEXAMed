/**
 * Phép tính thuần cho trang báo cáo "Chất lượng và tuân thủ" (docs/DECISIONS.md #290): tổng hợp liên thông đơn thuốc. Truy vấn SQL chỉ gom số đếm theo (trạng thái) và (bác sĩ, trạng thái);
 * việc quy trạng thái về "đã gửi / chờ / lỗi", tỉ lệ và xếp bác sĩ nằm ở đây để test được kỹ.
 */

/** Trạng thái hàng chờ liên thông: PENDING chờ gửi, SENT đã gửi, FAILED cổng từ chối, AMENDED đã gửi bản đính chính. */
export type InteropBucket = 'sent' | 'pending' | 'failed' | 'other';

export function interopBucket(status: string): InteropBucket {
  if (status === 'SENT' || status === 'AMENDED') return 'sent';
  if (status === 'PENDING') return 'pending';
  if (status === 'FAILED') return 'failed';
  return 'other';
}

export interface InteropStatusCount {
  status: string;
  count: number;
}

export interface InteropDoctorCount {
  doctorId: string | null;
  doctorName: string;
  status: string;
  count: number;
}

export interface InteropSummary {
  summary: { total: number; sent: number; pending: number; failed: number; sentPercent: number | null };
  byDoctor: Array<{ doctorName: string; total: number; sent: number; pending: number; failed: number }>;
}

const percent1 = (part: number, whole: number): number | null => (whole <= 0 ? null : Math.round((part / whole) * 1000) / 10);

/**
 * Tổng quan liên thông: `total` gồm cả trạng thái lạ (không mất đơn nào), tỉ lệ đã gửi tính trên tổng. Bác sĩ xếp nhiều đơn lỗi/chờ nhất trước (việc cần xử lý), hoà thì nhiều đơn nhất rồi theo tên.
 */
export function summarizeInterop(statusCounts: readonly InteropStatusCount[], doctors: readonly InteropDoctorCount[]): InteropSummary {
  const sum = (bucket: InteropBucket) => statusCounts.filter((s) => interopBucket(s.status) === bucket).reduce((n, s) => n + s.count, 0);
  const total = statusCounts.reduce((n, s) => n + s.count, 0);
  const sent = sum('sent');
  const byName = new Map<string, { doctorName: string; total: number; sent: number; pending: number; failed: number }>();
  for (const d of doctors) {
    const key = d.doctorId ?? '';
    const row = byName.get(key) ?? { doctorName: d.doctorName, total: 0, sent: 0, pending: 0, failed: 0 };
    row.total += d.count;
    const bucket = interopBucket(d.status);
    if (bucket !== 'other') row[bucket] += d.count;
    byName.set(key, row);
  }
  const byDoctor = [...byName.values()].sort((a, b) => b.failed + b.pending - (a.failed + a.pending) || b.total - a.total || a.doctorName.localeCompare(b.doctorName, 'vi'));
  return { summary: { total, sent, pending: sum('pending'), failed: sum('failed'), sentPercent: percent1(sent, total) }, byDoctor };
}
