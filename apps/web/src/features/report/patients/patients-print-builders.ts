import type { PatientDemographicsReport, PatientNewReturningReport, PatientNotReturningReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import type { ReportPrintSpec } from '../../../shared/print/report-print-spec';
import { formatPercent } from '../operations/operations-model';
import { formatDecimal, formatMonth, reminderLabel, shareOf } from './patients-model';

/**
 * Hàm THUẦN đổi báo cáo Bệnh nhân (đã tải trên màn hình) thành bản in A4 (docs/DECISIONS.md #287: mọi báo cáo phải in được trực tiếp). Không gọi API; `ReportTablePrintView` vẽ ra giấy qua loại
 * chứng từ `REPORT`. Cùng số liệu với màn hình và Excel.
 */
export interface PatientPrintContext {
  from: string;
  to: string;
  /** "Tất cả chi nhánh (3)" khi báo cáo gộp từ hai chi nhánh; `null` ở phạm vi một chi nhánh. */
  scopeLabel: string | null;
}

const n = (value: number | null): string => (value === null ? '—' : value.toLocaleString('vi-VN'));
const period = (from: string, to: string): string => `Từ ${formatDobDisplay(from)} đến ${formatDobDisplay(to)}`;
const subtitle = (ctx: PatientPrintContext): string[] => [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : [])];

export function buildPatientNewReturningPrintSpec(report: PatientNewReturningReport, ctx: PatientPrintContext): ReportPrintSpec {
  const s = report.summary;
  return {
    title: 'Bệnh nhân mới và cũ',
    subtitleLines: subtitle(ctx),
    infoLines: [
      `Bệnh nhân có khám: ${n(s.patients)} · Mới: ${n(s.newPatients)} · Cũ: ${n(s.returningPatients)} (${formatPercent(s.returningPercent)}) · Lượt khám: ${n(s.visits)} · Lượt mỗi bệnh nhân: ${formatDecimal(s.visitsPerPatient)}`,
      'Bệnh nhân mới: lượt khám đầu tiên (ở bất kỳ chi nhánh nào của công ty) rơi vào kỳ; bệnh nhân cũ: đã khám trước kỳ.',
    ],
    sections: [
      {
        title: 'Theo tháng',
        columns: [{ header: 'Tháng' }, { header: 'Bệnh nhân có khám', align: 'right' }, { header: 'Mới', align: 'right' }, { header: 'Cũ', align: 'right' }, { header: 'Lượt khám', align: 'right' }],
        rows: report.byMonth.map((m) => [formatMonth(m.month), n(m.patients), n(m.newPatients), n(m.returningPatients), n(m.visits)]),
        emptyText: 'Không có lượt khám nào trong kỳ.',
      },
      {
        title: 'Số lượt khám của mỗi bệnh nhân trong kỳ',
        columns: [{ header: 'Số lượt' }, { header: 'Số bệnh nhân', align: 'right' }, { header: 'Tỉ lệ', align: 'right' }],
        rows: report.frequency.map((f) => [f.label, n(f.patients), formatPercent(shareOf(f.patients, s.patients))]),
      },
      {
        title: 'Bệnh nhân cũ: quay lại sau',
        columns: [{ header: 'Khoảng' }, { header: 'Số bệnh nhân', align: 'right' }, { header: 'Tỉ lệ', align: 'right' }],
        rows: report.gap.map((g) => [g.label, n(g.patients), formatPercent(shareOf(g.patients, s.returningPatients))]),
      },
    ],
  };
}

export function buildPatientDemographicsPrintSpec(report: PatientDemographicsReport, ctx: PatientPrintContext): ReportPrintSpec {
  const g = report.genders;
  const sum = (key: 'male' | 'female' | 'other') => report.ageBands.reduce((s, b) => s + b[key], 0);
  return {
    title: 'Tuổi, giới và địa bàn',
    subtitleLines: subtitle(ctx),
    infoLines: [`Bệnh nhân có khám: ${n(report.patients)} · Nam: ${n(g.male)} · Nữ: ${n(g.female)} · Khác: ${n(g.other)}`, 'Tuổi tính đến ngày cuối kỳ; địa bàn theo tỉnh/thành và phường/xã ghi trên hồ sơ.'],
    sections: [
      {
        title: 'Theo khoảng tuổi và giới',
        columns: [{ header: 'Khoảng tuổi' }, { header: 'Nam', align: 'right' }, { header: 'Nữ', align: 'right' }, { header: 'Khác', align: 'right' }, { header: 'Cộng', align: 'right' }, { header: 'Tỉ lệ', align: 'right' }],
        rows: report.ageBands.map((b) => [b.label, n(b.male), n(b.female), n(b.other), n(b.total), formatPercent(shareOf(b.total, report.patients))]),
        totalRows: [
          ['Cộng', n(sum('male')), n(sum('female')), n(sum('other')), n(report.patients - report.unknownAge), ''],
          ...(report.unknownAge > 0 ? [['Chưa có ngày sinh hợp lệ', '', '', '', n(report.unknownAge), '']] : []),
        ],
      },
      {
        title: 'Theo tỉnh/thành',
        columns: [{ header: 'Tỉnh/thành' }, { header: 'Số bệnh nhân', align: 'right' }, { header: 'Tỉ lệ', align: 'right' }],
        rows: report.provinces.map((p) => [p.name, n(p.patients), formatPercent(shareOf(p.patients, report.patients))]),
        totalRows: report.unknownProvince > 0 ? [['Chưa ghi tỉnh/thành', n(report.unknownProvince), formatPercent(shareOf(report.unknownProvince, report.patients))]] : undefined,
        emptyText: 'Chưa có hồ sơ nào ghi tỉnh/thành.',
      },
      {
        title: 'Phường/xã có nhiều bệnh nhân nhất',
        columns: [{ header: 'Phường/xã' }, { header: 'Tỉnh/thành' }, { header: 'Số bệnh nhân', align: 'right' }],
        rows: report.wards.map((w) => [w.name, w.provinceName, n(w.patients)]),
        emptyText: 'Chưa có hồ sơ nào ghi phường/xã.',
      },
    ],
  };
}

export function buildPatientNotReturningPrintSpec(report: PatientNotReturningReport, ctx: PatientPrintContext): ReportPrintSpec {
  const s = report.summary;
  const multiBranch = report.branchCount > 1;
  return {
    title: 'Bệnh nhân không quay lại',
    subtitleLines: subtitle(ctx),
    infoLines: [
      `Bệnh nhân: ${n(s.patients)} · Đã được nhắc: ${n(s.reminded)} · Đã ghi không tái khám: ${n(s.markedNotReturning)} · Quá hạn trung bình: ${s.avgOverdueDays === null ? '—' : `${s.avgOverdueDays} ngày`}`,
      'Bệnh nhân có hẹn tái khám (kế hoạch đã ký) với ngày hẹn trong kỳ và đã qua, chưa có lượt khám nào sau lượt đã hẹn.',
    ],
    sections: [
      {
        columns: [
          { header: 'Mã BN' },
          { header: 'Bệnh nhân' },
          { header: 'Điện thoại' },
          ...(multiBranch ? [{ header: 'Chi nhánh' }] : []),
          { header: 'Ngày khám', align: 'right' as const },
          { header: 'Ngày hẹn', align: 'right' as const },
          { header: 'Quá hạn', align: 'right' as const },
          { header: 'Nhắc' },
        ],
        rows: report.items.map((r) => [
          r.patientCode,
          r.patientName,
          r.phone,
          ...(multiBranch ? [r.branchName] : []),
          formatDobDisplay(r.visitDate),
          formatDobDisplay(r.dueDate),
          `${n(r.overdueDays)} ngày`,
          r.reminderCount > 0 ? `${r.reminderCount} lần · ${reminderLabel(r.lastReminderResult)}` : reminderLabel(null),
        ]),
        emptyText: 'Không có bệnh nhân nào quá hẹn tái khám mà chưa quay lại trong kỳ đã chọn.',
      },
    ],
    ...(report.totalCount > report.items.length ? { note: `Chỉ in ${report.items.length} trong ${report.totalCount} bệnh nhân (quá hạn lâu nhất trước).` } : {}),
  };
}
