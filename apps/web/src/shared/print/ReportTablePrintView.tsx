import { PrintDocument } from './PrintDocument';
import { DEFAULT_REPORT_SIGNATURES, type ReportPrintSection, type ReportPrintSpec } from './report-print-spec';

const ALIGN: Record<'left' | 'right' | 'center', string> = { left: 'text-left', right: 'text-right tabular-nums', center: 'text-center' };

function Section({ section }: { section: ReportPrintSection }) {
  const { columns, rows, totalRows = [] } = section;
  return (
    <section className="mt-4">
      {section.title && <h2 className="mb-1 border-b-[1.5px] border-slate-900 pb-0.5 text-[13px] font-bold uppercase tracking-wide text-slate-900">{section.title}</h2>}
      {rows.length === 0 && totalRows.length === 0 ? (
        <p className="py-1.5 text-[13px] text-slate-600">{section.emptyText ?? 'Không có dữ liệu.'}</p>
      ) : (
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="table-header-group">
            <tr className="border-b border-slate-400">
              {columns.map((c, i) => (
                <th key={i} className={`px-1.5 py-1 text-[11.5px] font-bold uppercase tracking-wide text-slate-700 ${ALIGN[c.align ?? 'left']}`} style={c.width ? { width: c.width } : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="break-inside-avoid border-b border-slate-200">
                {row.map((cell, i) => (
                  <td key={i} className={`px-1.5 py-[3px] align-top ${ALIGN[columns[i]?.align ?? 'left']}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {totalRows.map((row, r) => (
              <tr key={`t${r}`} className="break-inside-avoid border-b border-slate-400 bg-slate-50 font-bold">
                {row.map((cell, i) => (
                  <td key={i} className={`px-1.5 py-[3px] align-top ${ALIGN[columns[i]?.align ?? 'left']}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Bản in báo cáo dạng bảng DÙNG CHUNG (docs/DECISIONS.md #287): khung/đầu trang/chữ ký/khổ giấy do `PrintDocument` lo theo bản mẫu `REPORT` ("Quản lý mẫu in"). Mặc định ẨN trên màn hình, chỉ hiện khi in
 * (`window.print()` từ nút "In" của báo cáo). Đầu bảng lặp lại ở mỗi trang, dòng không bị cắt đôi giữa hai trang.
 */
export function ReportTablePrintView({ spec }: { spec: ReportPrintSpec }) {
  const signatures = (spec.signatures ?? DEFAULT_REPORT_SIGNATURES).map((label) => ({ label }));
  return (
    <PrintDocument
      documentType="REPORT"
      title={spec.title}
      fixedTitle
      subtitle={spec.subtitleLines && spec.subtitleLines.length > 0 ? spec.subtitleLines.map((line, i) => <p key={i} className="text-xs text-slate-700">{line}</p>) : undefined}
      signatures={signatures.length > 0 ? signatures : undefined}
    >
      {spec.infoLines && spec.infoLines.length > 0 && (
        <div className="mt-3 text-[13px]">
          {spec.infoLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      {spec.sections.map((section, i) => (
        <Section key={i} section={section} />
      ))}
      {spec.note && <p className="mt-3 text-[12px] italic text-slate-700">{spec.note}</p>}
    </PrintDocument>
  );
}
