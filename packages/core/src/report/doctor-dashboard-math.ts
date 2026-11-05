import { ageInYears } from './reception-dashboard-math';

/**
 * Phép tính THUẦN của Trang Tổng quan bác sĩ (docs/DECISIONS.md #286). Máy chủ nạp lượt khám của CHÍNH bác sĩ hôm nay rồi gọi ở đây; không đọc cơ sở dữ liệu, không biết múi giờ ngoài độ lệch +7 giờ cố định.
 */

export interface DoctorEncounterInput {
  encounterId: string;
  status: 'CHECKED_IN' | 'IN_CONSULTATION' | 'COMPLETED';
  checkedInAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  patientName: string;
  patientCode: string;
  /** Ngày sinh `YYYY-MM-DD` hoặc `null`. */
  dob: string | null;
}

export interface DoctorWaitingItem {
  encounterId: string;
  patientName: string;
  patientCode: string;
  age: number | null;
  waitMinutes: number;
}

export interface DoctorEncounterSummary {
  total: number;
  waiting: { count: number; longestWaitMinutes: number | null };
  inProgress: { count: number; patientName: string | null; minutes: number | null };
  done: { count: number; averageMinutes: number | null };
  waitingList: { items: DoctorWaitingItem[]; moreCount: number };
  /** Đủ 24 giờ VN, theo giờ nhận (`checkedInAt`). */
  hourly: Array<{ hour: number; count: number }>;
}

/** Số phút nguyên (làm tròn xuống) từ `from` đến `to`; không bao giờ âm. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

/** Trung bình làm tròn về số nguyên (round-half-up); danh sách rỗng → `null`. */
export function roundedAverage(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.floor(values.reduce((s, v) => s + v, 0) / values.length + 0.5);
}

/** Trung bình lượt khám mỗi ngày CÓ khám (ngày nghỉ, không khám không kéo trung bình xuống); chưa có ngày nào → `null`. */
export function averagePerActiveDay(dailyCounts: readonly number[]): number | null {
  return roundedAverage(dailyCounts.filter((c) => c > 0));
}

/** Giờ VN (0–23) của một thời điểm UTC, bằng độ lệch +7 giờ cố định. */
export function vietnamHour(at: Date): number {
  return new Date(at.getTime() + 7 * 3_600_000).getUTCHours();
}

/**
 * Tóm tắt các lượt khám hôm nay của MỘT bác sĩ. Đang chờ: người chờ lâu nhất đứng đầu danh sách (tối đa `waitingLimit` dòng, phần còn lại ở `moreCount`). Đang khám: bệnh nhân bắt đầu khám
 * sớm nhất. Thời gian khám trung bình chỉ tính lượt đã xong có đủ giờ bắt đầu và giờ hoàn tất.
 */
export function summarizeDoctorEncounters(rows: readonly DoctorEncounterInput[], now: Date, today: string, waitingLimit: number): DoctorEncounterSummary {
  const waiting = rows.filter((r) => r.status === 'CHECKED_IN').sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime() || a.encounterId.localeCompare(b.encounterId));
  const inProgress = rows.filter((r) => r.status === 'IN_CONSULTATION').sort((a, b) => (a.startedAt ?? a.checkedInAt).getTime() - (b.startedAt ?? b.checkedInAt).getTime() || a.encounterId.localeCompare(b.encounterId));
  const done = rows.filter((r) => r.status === 'COMPLETED');

  const waits = waiting.map((r) => minutesBetween(r.checkedInAt, now));
  const first = inProgress[0];
  const doneMinutes = done.filter((r) => r.startedAt !== null && r.completedAt !== null).map((r) => minutesBetween(r.startedAt!, r.completedAt!));

  const counts = new Array<number>(24).fill(0);
  for (const r of rows) counts[vietnamHour(r.checkedInAt)] = (counts[vietnamHour(r.checkedInAt)] ?? 0) + 1;

  return {
    total: rows.length,
    waiting: { count: waiting.length, longestWaitMinutes: waits.length > 0 ? Math.max(...waits) : null },
    inProgress: {
      count: inProgress.length,
      patientName: first ? first.patientName : null,
      minutes: first ? minutesBetween(first.startedAt ?? first.checkedInAt, now) : null,
    },
    done: { count: done.length, averageMinutes: roundedAverage(doneMinutes) },
    waitingList: {
      items: waiting.slice(0, waitingLimit).map((r, i) => ({
        encounterId: r.encounterId,
        patientName: r.patientName,
        patientCode: r.patientCode,
        age: r.dob ? ageInYears(r.dob, today) : null,
        waitMinutes: waits[i]!,
      })),
      moreCount: Math.max(0, waiting.length - waitingLimit),
    },
    hourly: counts.map((count, hour) => ({ hour, count })),
  };
}
