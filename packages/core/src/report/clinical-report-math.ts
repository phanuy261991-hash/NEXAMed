/**
 * Phép tính thuần cho trang báo cáo "Chuyên môn" (docs/DECISIONS.md #287): cơ cấu chẩn đoán ICD-10 và cận lâm sàng. Truy vấn SQL chỉ gom số đếm theo nhóm; việc ghép thành tỉ lệ, trung bình,
 * xếp nhóm nằm ở đây để test được kỹ.
 */

const roundPercent = (part: number, whole: number): number | null => (whole <= 0 ? null : Math.round((part / whole) * 1000) / 10);
const roundedAverage = (sum: number, count: number): number | null => (count <= 0 ? null : Math.round(sum / count));

// ---- Chẩn đoán ----

export interface DiagnosisRaw {
  code: string;
  name: string;
  visits: number;
  patients: number;
}

export interface ChapterRaw {
  chapterCode: string;
  chapterName: string;
  visits: number;
}

export interface DiagnosisSummary {
  summary: { completedVisits: number; withDiagnosis: number; withoutDiagnosis: number; distinctCodes: number; topCode: string | null; topCodeName: string };
  rows: Array<DiagnosisRaw & { percent: number | null }>;
  chapters: Array<ChapterRaw & { percent: number | null }>;
}

/**
 * Cơ cấu chẩn đoán: `rows` đã xếp nhiều lượt nhất trước (hoà thì theo mã). Tỉ lệ tính trên số lượt có chẩn đoán chính (`withDiagnosis`). `distinctCodes` là số mã khác nhau
 * (có thể lớn hơn số dòng hiển thị khi danh sách bị cắt).
 */
export function summarizeDiagnoses(input: { completedVisits: number; withDiagnosis: number; distinctCodes: number; rows: readonly DiagnosisRaw[]; chapters: readonly ChapterRaw[] }): DiagnosisSummary {
  const rows = [...input.rows].sort((a, b) => b.visits - a.visits || a.code.localeCompare(b.code)).map((r) => ({ ...r, percent: roundPercent(r.visits, input.withDiagnosis) }));
  const chapters = [...input.chapters].sort((a, b) => b.visits - a.visits || a.chapterCode.localeCompare(b.chapterCode)).map((c) => ({ ...c, percent: roundPercent(c.visits, input.withDiagnosis) }));
  return {
    summary: {
      completedVisits: input.completedVisits,
      withDiagnosis: input.withDiagnosis,
      withoutDiagnosis: Math.max(0, input.completedVisits - input.withDiagnosis),
      distinctCodes: input.distinctCodes,
      topCode: rows[0]?.code ?? null,
      topCodeName: rows[0]?.name ?? '',
    },
    rows,
    chapters,
  };
}

// ---- Cận lâm sàng ----

export type ClsKind = 'LAB' | 'IMAGING' | 'FUNCTIONAL' | 'OTHER';

/** Thứ tự và nhãn nhóm dịch vụ (máy chủ dựng Excel; web có bản riêng vì chỉ được import KIỂU từ core). */
export const CLS_KIND_ORDER: readonly ClsKind[] = ['LAB', 'IMAGING', 'FUNCTIONAL', 'OTHER'];
export const CLS_KIND_LABEL: Record<ClsKind, string> = { LAB: 'Xét nghiệm', IMAGING: 'Chẩn đoán hình ảnh', FUNCTIONAL: 'Thăm dò chức năng', OTHER: 'Chỉ định ngoài (tên tự do)' };

/** Nhóm dịch vụ từ cột `service_kind` của dịch vụ kỹ thuật; không có (chỉ định ngoài tên tự do) hoặc giá trị lạ → `OTHER`. */
export function clsKindOf(raw: string | null): ClsKind {
  return raw === 'LAB' || raw === 'IMAGING' || raw === 'FUNCTIONAL' ? raw : 'OTHER';
}

/** Một nhóm (nhóm dịch vụ, nơi thực hiện) do SQL gom. */
export interface ClsKindRaw {
  kind: ClsKind;
  inHouse: boolean;
  ordered: number;
  completed: number;
  /** Số chỉ định đã trả kết quả mà đo được thời gian (có giờ duyệt), và tổng số phút của chúng. */
  measured: number;
  sumMinutes: number;
  /** Đã trả kết quả nhưng muộn hơn thời gian đặt ở dịch vụ. */
  lateCompleted: number;
  /** Chưa trả kết quả và đã quá thời gian đặt ở dịch vụ. */
  overdueOpen: number;
}

export interface ClsKindSummary {
  kind: ClsKind;
  ordered: number;
  inHouse: number;
  external: number;
  completed: number;
  avgMinutes: number | null;
  overdue: number;
}

export interface ClsSummary {
  summary: { ordered: number; inHouse: number; external: number; completed: number; pending: number; avgMinutes: number | null; overdue: number; overdueOpen: number; lateCompleted: number };
  byKind: ClsKindSummary[];
}

/** Gộp các nhóm SQL thành tổng quan và bảng theo nhóm dịch vụ (nhóm không có chỉ định nào không hiện). */
export function summarizeCls(rows: readonly ClsKindRaw[]): ClsSummary {
  const byKind: ClsKindSummary[] = [];
  for (const kind of CLS_KIND_ORDER) {
    const group = rows.filter((r) => r.kind === kind);
    if (group.length === 0) continue;
    const inHouse = group.filter((r) => r.inHouse).reduce((s, r) => s + r.ordered, 0);
    const ordered = group.reduce((s, r) => s + r.ordered, 0);
    byKind.push({
      kind,
      ordered,
      inHouse,
      external: ordered - inHouse,
      completed: group.reduce((s, r) => s + r.completed, 0),
      avgMinutes: roundedAverage(group.reduce((s, r) => s + r.sumMinutes, 0), group.reduce((s, r) => s + r.measured, 0)),
      overdue: group.reduce((s, r) => s + r.lateCompleted + r.overdueOpen, 0),
    });
  }
  const ordered = rows.reduce((s, r) => s + r.ordered, 0);
  const inHouse = rows.filter((r) => r.inHouse).reduce((s, r) => s + r.ordered, 0);
  const completed = rows.reduce((s, r) => s + r.completed, 0);
  const overdueOpen = rows.reduce((s, r) => s + r.overdueOpen, 0);
  const lateCompleted = rows.reduce((s, r) => s + r.lateCompleted, 0);
  return {
    summary: {
      ordered,
      inHouse,
      external: ordered - inHouse,
      completed,
      pending: Math.max(0, inHouse - completed),
      avgMinutes: roundedAverage(rows.reduce((s, r) => s + r.sumMinutes, 0), rows.reduce((s, r) => s + r.measured, 0)),
      overdue: overdueOpen + lateCompleted,
      overdueOpen,
      lateCompleted,
    },
    byKind,
  };
}
