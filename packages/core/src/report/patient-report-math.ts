/**
 * Phép tính thuần cho trang báo cáo "Bệnh nhân" (docs/DECISIONS.md #287): bệnh nhân mới và cũ, tuổi giới địa bàn. Truy vấn SQL chỉ gom số đếm theo nhóm; việc chia khoảng tuổi, khoảng cách
 * lần khám, tỉ lệ nằm ở đây để test được kỹ. Ngày `YYYY-MM-DD` theo lịch Việt Nam.
 */

/** Số lượt khám trong kỳ từ mốc này trở lên gộp chung một nhóm ("Từ 4 lượt"). */
export const FREQUENCY_MAX_VISITS = 4;

export function frequencyLabel(visits: number): string {
  return visits >= FREQUENCY_MAX_VISITS ? `Từ ${FREQUENCY_MAX_VISITS} lượt` : `${visits} lượt`;
}

/**
 * Cận trên (số ngày, tính cả mốc) của các khoảng "từ lượt khám liền trước đến lượt đầu tiên của kỳ": ≤ 30, 31–90, 91–180, 181–365, còn lại trên một năm. SQL dùng đúng mảng này
 * (`width_bucket` trên mốc bắt đầu của khoảng kế tiếp) nên hai nơi không lệch nhau.
 */
export const RETURN_GAP_UPPER_DAYS = [30, 90, 180, 365] as const;

export const RETURN_GAP_LABELS = ['Trong 30 ngày', '31–90 ngày', '91–180 ngày', '181–365 ngày', 'Trên 1 năm'] as const;

/** Mốc bắt đầu của các khoảng kế tiếp (31, 91, 181, 366) — đối số của `width_bucket`. */
export const RETURN_GAP_LOWER_BOUNDS = RETURN_GAP_UPPER_DAYS.map((d) => d + 1);

/** Chỉ số khoảng (0..4) của `days` ngày; âm coi như 0. */
export function returnGapIndex(days: number): number {
  const d = Math.max(0, days);
  const i = RETURN_GAP_UPPER_DAYS.findIndex((upper) => d <= upper);
  return i === -1 ? RETURN_GAP_UPPER_DAYS.length : i;
}

/** Một nhóm bệnh nhân: mới/cũ, số lượt khám trong kỳ (đã gộp tại `FREQUENCY_MAX_VISITS`), khoảng cách (chỉ bệnh nhân cũ). */
export interface NewReturningRaw {
  isNew: boolean;
  visits: number;
  gapIndex: number | null;
  patients: number;
  totalVisits: number;
}

export interface BucketCount {
  key: string;
  label: string;
  patients: number;
}

export interface NewReturningSummary {
  summary: {
    patients: number;
    newPatients: number;
    returningPatients: number;
    visits: number;
    visitsPerPatient: number | null;
    returningPercent: number | null;
  };
  frequency: BucketCount[];
  gap: BucketCount[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function summarizeNewReturning(rows: readonly NewReturningRaw[]): NewReturningSummary {
  const patients = rows.reduce((s, r) => s + r.patients, 0);
  const newPatients = rows.filter((r) => r.isNew).reduce((s, r) => s + r.patients, 0);
  const visits = rows.reduce((s, r) => s + r.totalVisits, 0);
  const returningPatients = patients - newPatients;
  const frequency: BucketCount[] = [];
  for (let v = 1; v <= FREQUENCY_MAX_VISITS; v += 1) {
    frequency.push({ key: String(v), label: frequencyLabel(v), patients: rows.filter((r) => Math.min(Math.max(r.visits, 1), FREQUENCY_MAX_VISITS) === v).reduce((s, r) => s + r.patients, 0) });
  }
  const gap: BucketCount[] = RETURN_GAP_LABELS.map((label, i) => ({
    key: String(i),
    label,
    patients: rows.filter((r) => !r.isNew && r.gapIndex === i).reduce((s, r) => s + r.patients, 0),
  }));
  return {
    summary: {
      patients,
      newPatients,
      returningPatients,
      visits,
      visitsPerPatient: patients > 0 ? round1(visits / patients) : null,
      returningPercent: patients > 0 ? round1((returningPatients / patients) * 100) : null,
    },
    frequency,
    gap,
  };
}

/** Các tháng `YYYY-MM` từ tháng của `from` đến tháng của `to` (tính cả hai đầu), để bảng theo tháng không đứt quãng. */
export function listMonthKeys(from: string, to: string): string[] {
  const start = /^(\d{4})-(\d{2})/.exec(from);
  const end = /^(\d{4})-(\d{2})/.exec(to);
  if (!start || !end) return [];
  let y = Number(start[1]);
  let m = Number(start[2]);
  const endY = Number(end[1]);
  const endM = Number(end[2]);
  const out: string[] = [];
  while ((y < endY || (y === endY && m <= endM)) && out.length < 400) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// ---- Tuổi, giới ----

export interface AgeBandDef {
  key: string;
  label: string;
  /** Tuổi nhỏ nhất và lớn nhất (tính cả hai đầu) của khoảng; `max` null = không giới hạn. */
  min: number;
  max: number | null;
}

export const AGE_BANDS: readonly AgeBandDef[] = [
  { key: 'under1', label: 'Dưới 1 tuổi', min: 0, max: 0 },
  { key: '1-5', label: '1–5 tuổi', min: 1, max: 5 },
  { key: '6-15', label: '6–15 tuổi', min: 6, max: 15 },
  { key: '16-30', label: '16–30 tuổi', min: 16, max: 30 },
  { key: '31-45', label: '31–45 tuổi', min: 31, max: 45 },
  { key: '46-60', label: '46–60 tuổi', min: 46, max: 60 },
  { key: 'over60', label: 'Trên 60 tuổi', min: 61, max: null },
];

export function ageBandKey(age: number): string | null {
  if (!Number.isFinite(age) || age < 0 || age > 150) return null;
  return AGE_BANDS.find((b) => age >= b.min && (b.max === null || age <= b.max))?.key ?? null;
}

export interface DemographicRaw {
  /** Tuổi tròn năm tính đến ngày cuối kỳ; `null` khi không có ngày sinh hợp lệ. */
  age: number | null;
  gender: string;
  patients: number;
}

export interface AgeBandCount {
  key: string;
  label: string;
  male: number;
  female: number;
  other: number;
  total: number;
}

export interface DemographicsSummary {
  patients: number;
  genders: { male: number; female: number; other: number };
  ageBands: AgeBandCount[];
  unknownAge: number;
}

function genderOf(raw: string): 'male' | 'female' | 'other' {
  return raw === 'male' ? 'male' : raw === 'female' ? 'female' : 'other';
}

export function summarizeDemographics(rows: readonly DemographicRaw[]): DemographicsSummary {
  const bands = new Map<string, AgeBandCount>(AGE_BANDS.map((b) => [b.key, { key: b.key, label: b.label, male: 0, female: 0, other: 0, total: 0 }]));
  const genders = { male: 0, female: 0, other: 0 };
  let unknownAge = 0;
  let patients = 0;
  for (const r of rows) {
    const g = genderOf(r.gender);
    patients += r.patients;
    genders[g] += r.patients;
    const key = r.age === null ? null : ageBandKey(r.age);
    if (key === null) {
      unknownAge += r.patients;
      continue;
    }
    const band = bands.get(key)!;
    band[g] += r.patients;
    band.total += r.patients;
  }
  return { patients, genders, ageBands: [...bands.values()], unknownAge };
}

/** Số ngày quá hẹn: `today − dueDate` (cả hai `YYYY-MM-DD`); chưa quá hẹn hoặc sai định dạng → 0. */
export function overdueDays(dueDate: string, today: string): number {
  const a = Date.parse(`${dueDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
