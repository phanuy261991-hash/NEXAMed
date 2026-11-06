import type { QualityIncompleteReport, QualityInteropReport } from '@nexamed/shared';
import type { ReportExcelHeader } from '../../common/report-excel-header';
import type { ReportExportContext } from '../../common/report-export-support';
import { buildTableReportExcel } from '../../common/report-table-excel';

/**
 * Bản Excel của trang báo cáo "Chất lượng và tuân thủ" (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel). Mỗi hàm đổi báo cáo đã tính (cùng số với màn hình) thành bảng Excel có đầu chuẩn;
 * ô số ghi SỐ để cộng/lọc được trong Excel. Không biết gì về truy vấn hay phạm vi — nhận ngữ cảnh đã dựng sẵn.
 */
const pct = (value: number | null): string => (value === null ? '—' : `${String(value).replace('.', ',')}%`);
const day = (d: string): string => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const dateTime = (iso: string): string => {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

const ENCOUNTER_STATUS: Record<string, string> = { CHECKED_IN: 'Chờ khám', IN_CONSULTATION: 'Đang khám' };
const INTEROP_STATUS: Record<string, string> = { PENDING: 'Chờ gửi', FAILED: 'Cổng từ chối', SENT: 'Đã gửi', AMENDED: 'Đã gửi bản sửa' };

function header(ctx: ReportExportContext, title: string, from: string, to: string): ReportExcelHeader {
  return { clinicName: ctx.clinicName, branchName: ctx.branchName, title, from, to, scopeLabel: ctx.scopeLabel, exportedByName: ctx.exportedByName, exportedAt: ctx.exportedAt };
}

export function buildQualityIncompleteExcel(report: QualityIncompleteReport, ctx: ReportExportContext): Promise<Buffer> {
  const s = report.summary;
  const multiBranch = report.branchCount > 1;
  return buildTableReportExcel([
    {
      name: 'Lượt khám chưa hoàn tất',
      header: header(ctx, 'Lượt khám chưa hoàn tất', report.asOf, report.asOf),
      infoLines: [
        `Tình trạng đến hết ngày ${day(report.asOf)}: lượt khám chờ khám hoặc đang khám từ các ngày trước, ca thu ngân mở từ các ngày trước mà chưa đóng, phiếu thu chưa thu của lượt khám từ các ngày trước.`,
        `Lượt khám treo: ${s.staleEncounters} · Ca thu ngân chưa đóng: ${s.openShifts} · Phiếu chưa thu từ ngày trước: ${s.unpaidInvoices} (chi tiết ở báo cáo Doanh thu → Phiếu chưa thu)`,
      ],
      sections: [
        {
          title: 'Lượt khám treo',
          columns: [
            { header: 'Mã lượt khám', width: 18 },
            { header: 'Mã bệnh nhân', width: 16 },
            { header: 'Bệnh nhân', width: 28 },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
            { header: 'Bác sĩ', width: 24 },
            { header: 'Trạng thái', width: 14 },
            { header: 'Ngày tiếp nhận', width: 16 },
            { header: 'Đã treo (ngày)', width: 15, numeric: true },
          ],
          rows: report.encounters.map((r) => [r.encounterNo, r.patientCode, r.patientName, ...(multiBranch ? [r.branchName] : []), r.doctorName ?? '—', ENCOUNTER_STATUS[r.status] ?? r.status, day(r.visitDate), r.daysOpen]),
          emptyText: 'Không có lượt khám nào treo từ các ngày trước.',
        },
        {
          title: 'Ca thu ngân chưa đóng',
          columns: [
            { header: 'Mã ca', width: 18 },
            { header: 'Thu ngân', width: 26 },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
            { header: 'Mở lúc', width: 18 },
            { header: 'Đã mở (ngày)', width: 15, numeric: true },
          ],
          rows: report.shifts.map((r) => [r.shiftNo, r.cashierName, ...(multiBranch ? [r.branchName] : []), dateTime(r.openedAt), r.daysOpen]),
          emptyText: 'Không có ca thu ngân nào mở từ các ngày trước.',
        },
      ],
      note: s.staleEncounters > report.encounters.length ? `Chỉ hiện ${report.encounters.length} trong ${s.staleEncounters} lượt khám treo (treo lâu nhất trước).` : undefined,
    },
  ]);
}

export function buildQualityInteropExcel(report: QualityInteropReport, ctx: ReportExportContext): Promise<Buffer> {
  const s = report.summary;
  const multiBranch = report.branchCount > 1;
  return buildTableReportExcel([
    {
      name: 'Liên thông đơn thuốc',
      header: header(ctx, 'Liên thông đơn thuốc', report.from, report.to),
      infoLines: [
        'Đơn thuốc đã ký trong kỳ (theo ngày ký) và tình trạng gửi lên cổng đơn thuốc quốc gia. Đã gửi gồm cả bản đính chính đã gửi lại; tồn = chờ gửi hoặc cổng từ chối.',
        `Đơn: ${s.total} · Đã gửi: ${s.sent} (${pct(s.sentPercent)}) · Chờ gửi: ${s.pending} · Cổng từ chối: ${s.failed} · Tồn cũ nhất: ${s.oldestUnsentDays === null ? '—' : `${s.oldestUnsentDays} ngày`}`,
      ],
      sections: [
        {
          title: 'Theo bác sĩ',
          columns: [{ header: 'Bác sĩ', width: 28 }, { header: 'Đơn', width: 10, numeric: true }, { header: 'Đã gửi', width: 10, numeric: true }, { header: 'Chờ gửi', width: 10, numeric: true }, { header: 'Cổng từ chối', width: 14, numeric: true }],
          rows: report.byDoctor.map((d) => [d.doctorName, d.total, d.sent, d.pending, d.failed]),
          totalRows: [['Cộng', s.total, s.sent, s.pending, s.failed]],
          emptyText: 'Không có đơn thuốc nào ký trong kỳ đã chọn.',
        },
        {
          title: 'Đơn chờ gửi hoặc bị cổng từ chối',
          columns: [
            { header: 'Mã lượt khám', width: 18 },
            { header: 'Mã bệnh nhân', width: 16 },
            { header: 'Bệnh nhân', width: 26 },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
            { header: 'Bác sĩ', width: 24 },
            { header: 'Mã đơn quốc gia', width: 22 },
            { header: 'Ký lúc', width: 18 },
            { header: 'Trạng thái', width: 16 },
            { header: 'Số lần thử', width: 12, numeric: true },
            { header: 'Lỗi', width: 60 },
          ],
          rows: report.problems.map((r) => [
            r.encounterNo,
            r.patientCode,
            r.patientName,
            ...(multiBranch ? [r.branchName] : []),
            r.doctorName ?? '—',
            r.nationalCode,
            dateTime(r.signedAt),
            INTEROP_STATUS[r.status] ?? r.status,
            r.attempts,
            r.errors.join('; '),
          ]),
          emptyText: 'Không có đơn nào chờ gửi hoặc bị cổng từ chối.',
        },
      ],
      note: report.problemTotal > report.problems.length ? `Chỉ hiện ${report.problems.length} trong ${report.problemTotal} đơn tồn (cũ nhất trước).` : undefined,
    },
  ]);
}
