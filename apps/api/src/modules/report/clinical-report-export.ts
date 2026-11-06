import { CLS_KIND_LABEL } from '@nexamed/core';
import type { ClinicalDiagnosisReport, ClinicalParaclinicalReport } from '@nexamed/shared';
import type { ReportExcelHeader } from '../../common/report-excel-header';
import type { ReportExportContext } from '../../common/report-export-support';
import { buildTableReportExcel } from '../../common/report-table-excel';

/**
 * Bản Excel của trang báo cáo "Chuyên môn" (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel). Mỗi hàm đổi báo cáo đã tính (cùng số với màn hình) thành bảng Excel có đầu chuẩn; ô số
 * ghi SỐ để cộng/lọc được trong Excel. Không biết gì về truy vấn hay phạm vi — nhận ngữ cảnh đã dựng sẵn.
 */
const pct = (value: number | null): string => (value === null ? '—' : `${String(value).replace('.', ',')}%`);

function header(ctx: ReportExportContext, title: string, from: string, to: string): ReportExcelHeader {
  return { clinicName: ctx.clinicName, branchName: ctx.branchName, title, from, to, scopeLabel: ctx.scopeLabel, exportedByName: ctx.exportedByName, exportedAt: ctx.exportedAt };
}

const dateTime = (iso: string): string => {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

export function buildClinicalDiagnosisExcel(report: ClinicalDiagnosisReport, ctx: ReportExportContext): Promise<Buffer> {
  const s = report.summary;
  return buildTableReportExcel([
    {
      name: 'Cơ cấu chẩn đoán ICD-10',
      header: header(ctx, 'Cơ cấu chẩn đoán ICD-10', report.from, report.to),
      infoLines: [
        'Lượt khám đã hoàn tất theo ngày tiếp nhận; mã chẩn đoán chính hiện hành (bản đã đính chính thay bản gốc). Tỉ lệ tính trên số lượt có chẩn đoán chính.',
        `Lượt hoàn tất: ${s.completedVisits} · Có chẩn đoán chính: ${s.withDiagnosis} · Chưa có chẩn đoán: ${s.withoutDiagnosis} · Số mã khác nhau: ${s.distinctCodes}`,
      ],
      sections: [
        {
          title: 'Bệnh hay gặp',
          columns: [{ header: '#', width: 6, numeric: true }, { header: 'Mã ICD-10', width: 12 }, { header: 'Tên bệnh', width: 52 }, { header: 'Lượt khám', width: 12, numeric: true }, { header: 'Bệnh nhân', width: 12, numeric: true }, { header: 'Tỉ lệ', width: 10 }],
          rows: report.rows.map((r, i) => [i + 1, r.code, r.name, r.visits, r.patients, pct(r.percent)]),
          emptyText: 'Chưa có lượt khám nào có chẩn đoán trong kỳ đã chọn.',
        },
        {
          title: 'Theo chương ICD-10',
          columns: [{ header: 'Chương', width: 10 }, { header: 'Tên chương', width: 60 }, { header: 'Lượt khám', width: 12, numeric: true }, { header: 'Tỉ lệ', width: 10 }],
          rows: report.chapters.map((c) => [c.chapterCode, c.chapterName, c.visits, pct(c.percent)]),
          emptyText: 'Chưa có dữ liệu.',
        },
      ],
    },
  ]);
}

export function buildClinicalParaclinicalExcel(report: ClinicalParaclinicalReport, ctx: ReportExportContext): Promise<Buffer> {
  const s = report.summary;
  const multiBranch = report.branchCount > 1;
  return buildTableReportExcel([
    {
      name: 'Cận lâm sàng',
      header: header(ctx, 'Cận lâm sàng', report.from, report.to),
      infoLines: [
        'Chỉ định của lượt khám đã tiếp nhận trong kỳ, không tính dòng đã huỷ. Thời gian trả kết quả = từ lúc chỉ định đến lần bác sĩ duyệt đầu tiên. Quá hạn: so với thời gian trả kết quả đặt ở dịch vụ (dịch vụ chưa đặt thì không xét).',
        `Chỉ định: ${s.ordered} (tại phòng khám ${s.inHouse}, ra ngoài ${s.external}) · Đã trả kết quả: ${s.completed} · Chưa trả: ${s.pending} · Quá hạn: ${s.overdue} (đã trả muộn ${s.lateCompleted}, đang chờ ${s.overdueOpen})`,
      ],
      sections: [
        {
          title: 'Theo nhóm dịch vụ',
          columns: [
            { header: 'Nhóm', width: 28 },
            { header: 'Chỉ định', width: 12, numeric: true },
            { header: 'Tại phòng khám', width: 16, numeric: true },
            { header: 'Ra ngoài', width: 12, numeric: true },
            { header: 'Đã trả kết quả', width: 16, numeric: true },
            { header: 'Phút trả kết quả (trung bình)', width: 26, numeric: true },
            { header: 'Quá hạn', width: 10, numeric: true },
          ],
          rows: report.byKind.map((k) => [CLS_KIND_LABEL[k.kind], k.ordered, k.inHouse, k.external, k.completed, k.avgMinutes, k.overdue]),
          totalRows: [['Cộng', s.ordered, s.inHouse, s.external, s.completed, s.avgMinutes, s.overdue]],
          emptyText: 'Chưa có chỉ định cận lâm sàng nào trong kỳ đã chọn.',
        },
        {
          title: 'Dịch vụ được chỉ định nhiều nhất',
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Dịch vụ', width: 40 },
            { header: 'Nhóm', width: 26 },
            { header: 'Chỉ định', width: 12, numeric: true },
            { header: 'Đã trả kết quả', width: 16, numeric: true },
            { header: 'Phút trả kết quả (trung bình)', width: 26, numeric: true },
            { header: 'Quá hạn', width: 10, numeric: true },
          ],
          rows: report.topServices.map((t, i) => [i + 1, t.name, CLS_KIND_LABEL[t.kind], t.ordered, t.completed, t.avgMinutes, t.overdue]),
          emptyText: 'Chưa có chỉ định nào trong kỳ.',
        },
        {
          title: 'Đang chờ và đã quá hạn',
          columns: [
            { header: 'Mã bệnh nhân', width: 16 },
            { header: 'Bệnh nhân', width: 26 },
            { header: 'Dịch vụ', width: 34 },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
            { header: 'Chỉ định lúc', width: 18 },
            { header: 'Thời gian đặt (phút)', width: 20, numeric: true },
            { header: 'Đã chờ (phút)', width: 15, numeric: true },
          ],
          rows: report.overdueItems.map((o) => [o.patientCode, o.patientName, o.serviceName, ...(multiBranch ? [o.branchName] : []), dateTime(o.orderedAt), o.turnaroundMinutes, o.waitedMinutes]),
          emptyText: 'Không có chỉ định nào đang chờ quá hạn.',
        },
      ],
      note: s.overdueOpen > report.overdueItems.length ? `Chỉ hiện ${report.overdueItems.length} trong ${s.overdueOpen} chỉ định đang chờ quá hạn (chờ lâu nhất trước).` : undefined,
    },
  ]);
}
