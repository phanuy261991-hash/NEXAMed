import type { DoctorHoursReport, DoctorOrderMixReport, DoctorPerformanceReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import type { ReportPrintSpec } from '../../../shared/print/report-print-spec';
import { formatPercent } from '../operations/operations-model';
import { formatDecimal, formatDuration } from './doctors-model';

/**
 * Hàm THUẦN đổi báo cáo Bác sĩ (đã tải trên màn hình) thành bản in A4 (docs/DECISIONS.md #287: mọi báo cáo phải in được trực tiếp). Không gọi API; `ReportTablePrintView` vẽ ra giấy qua loại chứng từ
 * `REPORT`. Số tiền không hậu tố "đ" (đơn vị đã rõ từ ngữ cảnh), cùng cách của các báo cáo đã có.
 */
export interface DoctorPrintContext {
  from: string;
  to: string;
  /** "Quận 1, Quận 7" khi báo cáo gộp từ hai chi nhánh; `null` ở công ty/phạm vi một chi nhánh. */
  scopeLabel: string | null;
  /** Tên Khoa đang lọc; `null` = mọi Khoa. */
  departmentLabel: string | null;
}

const n = (value: number | null): string => (value === null ? '—' : value.toLocaleString('vi-VN'));
const period = (from: string, to: string): string => `Từ ${formatDobDisplay(from)} đến ${formatDobDisplay(to)}`;

function subtitle(ctx: DoctorPrintContext): string[] {
  return [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : []), ...(ctx.departmentLabel ? [`Khoa: ${ctx.departmentLabel}`] : [])];
}

export function buildDoctorPerformancePrintSpec(report: DoctorPerformanceReport, ctx: DoctorPrintContext): ReportPrintSpec {
  const t = report.totals;
  return {
    title: 'Hiệu suất theo bác sĩ',
    subtitleLines: subtitle(ctx),
    infoLines: [
      `Bác sĩ có khám: ${n(t.doctorCount)} · Lượt khám: ${n(t.visits)} · Phút khám trung bình: ${t.avgMinutes === null ? '—' : t.avgMinutes} · Doanh thu sinh ra: ${n(t.revenue)} · Một lượt: ${n(t.revenuePerVisit)}`,
      'Lượt khám: lượt đã hoàn tất. Doanh thu sinh ra: ghi nhận theo ngày khám, đã trừ chiết khấu.',
    ],
    sections: [
      {
        columns: [
          { header: '#', align: 'right' },
          { header: 'Bác sĩ' },
          { header: 'Khoa' },
          { header: 'Lượt khám', align: 'right' },
          { header: 'Phút / lượt', align: 'right' },
          { header: 'Doanh thu sinh ra', align: 'right' },
          { header: 'Một lượt', align: 'right' },
          { header: 'Có CLS', align: 'right' },
          { header: 'Có thuốc', align: 'right' },
          { header: 'Hẹn tái khám', align: 'right' },
        ],
        rows: report.rows.map((r) => [String(r.rank), r.doctorName, r.departmentName, n(r.visits), n(r.avgMinutes), n(r.revenue), n(r.revenuePerVisit), formatPercent(r.clsPercent), formatPercent(r.drugPercent), formatPercent(r.followUpPercent)]),
        totalRows: [['', `Cộng ${t.doctorCount} bác sĩ`, '', n(t.visits), n(t.avgMinutes), n(t.revenue), n(t.revenuePerVisit), formatPercent(t.clsPercent), formatPercent(t.drugPercent), formatPercent(t.followUpPercent)]],
        emptyText: 'Không có bác sĩ nào khám trong kỳ đã chọn.',
      },
    ],
  };
}

export function buildDoctorOrderMixPrintSpec(report: DoctorOrderMixReport, ctx: DoctorPrintContext): ReportPrintSpec {
  const t = report.totals;
  return {
    title: 'Cơ cấu kê đơn và chỉ định',
    subtitleLines: subtitle(ctx),
    infoLines: [`Lượt khám: ${n(t.visits)} · Lượt có thuốc: ${n(t.withPrescription)} · Dòng thuốc / đơn: ${formatDecimal(t.itemsPerPrescription)} · Lượt có CLS: ${n(t.withCls)} (tại phòng khám ${n(t.clsInHouse)}, ra ngoài ${n(t.clsExternal)})`],
    sections: [
      {
        title: 'Theo bác sĩ',
        columns: [
          { header: 'Bác sĩ' },
          { header: 'Khoa' },
          { header: 'Lượt khám', align: 'right' },
          { header: 'Lượt có thuốc', align: 'right' },
          { header: 'Dòng thuốc', align: 'right' },
          { header: 'Dòng / đơn', align: 'right' },
          { header: 'Lượt có CLS', align: 'right' },
          { header: 'CLS tại PK', align: 'right' },
          { header: 'CLS ra ngoài', align: 'right' },
          { header: 'Có hẹn tái khám', align: 'right' },
        ],
        rows: report.rows.map((r) => [r.doctorName, r.departmentName, n(r.visits), n(r.withPrescription), n(r.prescriptionItems), formatDecimal(r.itemsPerPrescription), n(r.withCls), n(r.clsInHouse), n(r.clsExternal), n(r.withFollowUp)]),
        totalRows: [['Cộng', '', n(t.visits), n(t.withPrescription), n(t.prescriptionItems), formatDecimal(t.itemsPerPrescription), n(t.withCls), n(t.clsInHouse), n(t.clsExternal), n(t.withFollowUp)]],
        emptyText: 'Không có bác sĩ nào khám trong kỳ đã chọn.',
      },
      {
        title: 'Thuốc kê nhiều nhất',
        columns: [{ header: 'STT', align: 'right' }, { header: 'Thuốc' }, { header: 'Số dòng kê', align: 'right' }, { header: 'Số bác sĩ kê', align: 'right' }],
        rows: report.topDrugs.map((d, i) => [String(i + 1), d.name, n(d.count), n(d.doctorCount)]),
        emptyText: 'Chưa có đơn thuốc nào trong kỳ.',
      },
      {
        title: 'Chỉ định cận lâm sàng nhiều nhất',
        columns: [{ header: 'STT', align: 'right' }, { header: 'Chỉ định' }, { header: 'Số lần chỉ định', align: 'right' }, { header: 'Số bác sĩ chỉ định', align: 'right' }],
        rows: report.topOrders.map((d, i) => [String(i + 1), d.name, n(d.count), n(d.doctorCount)]),
        emptyText: 'Chưa có chỉ định cận lâm sàng nào trong kỳ.',
      },
    ],
  };
}

export function buildDoctorHoursPrintSpec(report: DoctorHoursReport, ctx: DoctorPrintContext): ReportPrintSpec {
  const t = report.totals;
  return {
    title: 'Giờ làm việc và lượt khám',
    subtitleLines: subtitle(ctx),
    infoLines: [
      `Giờ ca đã xếp: ${formatDuration(t.scheduledMinutes)} · Giờ khám thực tế: ${formatDuration(t.consultMinutes)} · Tỉ lệ sử dụng: ${formatPercent(t.utilizationPercent)} · Nghỉ phép: ${n(t.leaveDays)} ngày`,
      'Ca đã xếp theo Lịch làm việc (trừ giờ nghỉ giữa ca); nghỉ phép là đơn đã duyệt. Tỉ lệ sử dụng = phút khám ÷ phút ca đã xếp.',
    ],
    sections: [
      {
        columns: [
          { header: 'Bác sĩ' },
          { header: 'Khoa' },
          { header: 'Ngày có ca', align: 'right' },
          { header: 'Giờ ca', align: 'right' },
          { header: 'Nghỉ phép', align: 'right' },
          { header: 'Ngày có khám', align: 'right' },
          { header: 'Lượt khám', align: 'right' },
          { header: 'Lượt / ngày', align: 'right' },
          { header: 'Giờ khám', align: 'right' },
          { header: 'Tỉ lệ sử dụng', align: 'right' },
        ],
        rows: report.rows.map((r) => [r.doctorName, r.departmentName, n(r.scheduledDays), formatDuration(r.scheduledMinutes), `${n(r.leaveDays)} ngày`, n(r.activeDays), n(r.visits), formatDecimal(r.visitsPerActiveDay), formatDuration(r.consultMinutes), formatPercent(r.utilizationPercent)]),
        totalRows: [[`Cộng ${t.doctorCount} bác sĩ`, '', n(t.scheduledDays), formatDuration(t.scheduledMinutes), `${n(t.leaveDays)} ngày`, n(t.activeDays), n(t.visits), '', formatDuration(t.consultMinutes), formatPercent(t.utilizationPercent)]],
        emptyText: 'Không có bác sĩ nào trong phạm vi đã chọn.',
      },
    ],
  };
}
