import type { DoctorHoursReport, DoctorOrderMixReport, DoctorPerformanceReport } from '@nexamed/shared';
import type { ReportExcelHeader } from '../../common/report-excel-header';
import type { ReportExportContext } from '../../common/report-export-support';
import { buildTableReportExcel } from '../../common/report-table-excel';

/**
 * Bản Excel của trang báo cáo "Bác sĩ" (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel). Mỗi hàm đổi báo cáo đã tính (cùng số với màn hình) thành bảng Excel có đầu chuẩn; ô số ghi
 * SỐ để cộng/lọc được trong Excel. Không biết gì về truy vấn hay phạm vi — nhận ngữ cảnh đã dựng sẵn.
 */
export interface DoctorExcelContext extends ReportExportContext {
  /** Tên Khoa đang lọc; `null` = mọi Khoa. */
  departmentLabel: string | null;
}

const pct = (value: number | null): string => (value === null ? '—' : `${String(value).replace('.', ',')}%`);
const hours = (minutes: number): string => `${Math.floor(minutes / 60)} giờ ${String(minutes % 60).padStart(2, '0')} phút`;

function header(ctx: DoctorExcelContext, title: string, from: string, to: string): ReportExcelHeader {
  return { clinicName: ctx.clinicName, branchName: ctx.branchName, title, from, to, scopeLabel: ctx.scopeLabel, exportedByName: ctx.exportedByName, exportedAt: ctx.exportedAt };
}

const filterLine = (ctx: DoctorExcelContext): string[] => (ctx.departmentLabel ? [`Khoa: ${ctx.departmentLabel}`] : []);

export function buildDoctorPerformanceExcel(report: DoctorPerformanceReport, ctx: DoctorExcelContext): Promise<Buffer> {
  const t = report.totals;
  return buildTableReportExcel([
    {
      name: 'Hiệu suất theo bác sĩ',
      header: header(ctx, 'Hiệu suất theo bác sĩ', report.from, report.to),
      infoLines: [...filterLine(ctx), 'Lượt khám: lượt đã hoàn tất. Doanh thu sinh ra: ghi nhận theo ngày khám, đã trừ chiết khấu, của các lượt bác sĩ đã khám.'],
      sections: [
        {
          columns: [
            { header: '#', width: 6, numeric: true },
            { header: 'Bác sĩ', width: 28 },
            { header: 'Khoa', width: 20 },
            { header: 'Lượt khám', width: 12, numeric: true },
            { header: 'Phút / lượt', width: 12, numeric: true },
            { header: 'Doanh thu sinh ra', width: 20, numeric: true },
            { header: 'Một lượt', width: 14, numeric: true },
            { header: 'Có CLS', width: 10 },
            { header: 'Có thuốc', width: 10 },
            { header: 'Hẹn tái khám', width: 14 },
          ],
          rows: report.rows.map((r) => [r.rank, r.doctorName, r.departmentName, r.visits, r.avgMinutes, r.revenue, r.revenuePerVisit, pct(r.clsPercent), pct(r.drugPercent), pct(r.followUpPercent)]),
          totalRows: [['', `Cộng ${t.doctorCount} bác sĩ`, '', t.visits, t.avgMinutes, t.revenue, t.revenuePerVisit, pct(t.clsPercent), pct(t.drugPercent), pct(t.followUpPercent)]],
          emptyText: 'Không có bác sĩ nào khám trong kỳ đã chọn.',
        },
      ],
    },
  ]);
}

export function buildDoctorOrderMixExcel(report: DoctorOrderMixReport, ctx: DoctorExcelContext): Promise<Buffer> {
  const t = report.totals;
  return buildTableReportExcel([
    {
      name: 'Cơ cấu kê đơn và chỉ định',
      header: header(ctx, 'Cơ cấu kê đơn và chỉ định', report.from, report.to),
      infoLines: [...filterLine(ctx), 'Lượt khám: lượt đã hoàn tất. Chỉ định cận lâm sàng không tính dòng đã huỷ.'],
      sections: [
        {
          title: 'Theo bác sĩ',
          columns: [
            { header: 'Bác sĩ', width: 28 },
            { header: 'Khoa', width: 20 },
            { header: 'Lượt khám', width: 12, numeric: true },
            { header: 'Lượt có thuốc', width: 14, numeric: true },
            { header: 'Số dòng thuốc', width: 14, numeric: true },
            { header: 'Dòng thuốc / đơn', width: 16, numeric: true },
            { header: 'Lượt có CLS', width: 14, numeric: true },
            { header: 'CLS tại phòng khám', width: 18, numeric: true },
            { header: 'CLS ra ngoài', width: 14, numeric: true },
            { header: 'Lượt có hẹn tái khám', width: 18, numeric: true },
          ],
          rows: report.rows.map((r) => [r.doctorName, r.departmentName, r.visits, r.withPrescription, r.prescriptionItems, r.itemsPerPrescription, r.withCls, r.clsInHouse, r.clsExternal, r.withFollowUp]),
          totalRows: [['Cộng', '', t.visits, t.withPrescription, t.prescriptionItems, t.itemsPerPrescription, t.withCls, t.clsInHouse, t.clsExternal, t.withFollowUp]],
          emptyText: 'Không có bác sĩ nào khám trong kỳ đã chọn.',
        },
        {
          title: 'Thuốc kê nhiều nhất',
          columns: [{ header: 'STT', width: 7, numeric: true }, { header: 'Thuốc', width: 44 }, { header: 'Số dòng kê', width: 14, numeric: true }, { header: 'Số bác sĩ kê', width: 14, numeric: true }],
          rows: report.topDrugs.map((d, i) => [i + 1, d.name, d.count, d.doctorCount]),
          emptyText: 'Chưa có đơn thuốc nào trong kỳ.',
        },
        {
          title: 'Chỉ định cận lâm sàng nhiều nhất',
          columns: [{ header: 'STT', width: 7, numeric: true }, { header: 'Chỉ định', width: 44 }, { header: 'Số lần chỉ định', width: 16, numeric: true }, { header: 'Số bác sĩ chỉ định', width: 18, numeric: true }],
          rows: report.topOrders.map((d, i) => [i + 1, d.name, d.count, d.doctorCount]),
          emptyText: 'Chưa có chỉ định cận lâm sàng nào trong kỳ.',
        },
      ],
    },
  ]);
}

export function buildDoctorHoursExcel(report: DoctorHoursReport, ctx: DoctorExcelContext): Promise<Buffer> {
  const t = report.totals;
  return buildTableReportExcel([
    {
      name: 'Giờ làm việc và lượt khám',
      header: header(ctx, 'Giờ làm việc và lượt khám', report.from, report.to),
      infoLines: [
        ...filterLine(ctx),
        'Ca đã xếp theo Lịch làm việc (trừ giờ nghỉ giữa ca); nghỉ phép là đơn đã duyệt. Tỉ lệ sử dụng = phút khám thực tế ÷ phút ca đã xếp.',
        `Tổng phút ca đã xếp: ${hours(t.scheduledMinutes)} · Tổng phút khám: ${hours(t.consultMinutes)}`,
      ],
      sections: [
        {
          columns: [
            { header: 'Bác sĩ', width: 28 },
            { header: 'Khoa', width: 20 },
            { header: 'Ngày có ca', width: 12, numeric: true },
            { header: 'Phút ca đã xếp', width: 16, numeric: true },
            { header: 'Ngày nghỉ phép', width: 15, numeric: true },
            { header: 'Phút nghỉ phép', width: 15, numeric: true },
            { header: 'Ngày có khám', width: 14, numeric: true },
            { header: 'Lượt khám', width: 12, numeric: true },
            { header: 'Lượt / ngày khám', width: 16, numeric: true },
            { header: 'Phút khám', width: 12, numeric: true },
            { header: 'Tỉ lệ sử dụng', width: 14 },
          ],
          rows: report.rows.map((r) => [r.doctorName, r.departmentName, r.scheduledDays, r.scheduledMinutes, r.leaveDays, r.leaveMinutes, r.activeDays, r.visits, r.visitsPerActiveDay, r.consultMinutes, pct(r.utilizationPercent)]),
          totalRows: [[`Cộng ${t.doctorCount} bác sĩ`, '', t.scheduledDays, t.scheduledMinutes, t.leaveDays, t.leaveMinutes, t.activeDays, t.visits, null, t.consultMinutes, pct(t.utilizationPercent)]],
          emptyText: 'Không có bác sĩ nào trong phạm vi đã chọn.',
        },
      ],
    },
  ]);
}
