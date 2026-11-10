import { useMemo, useState } from 'react';
import { formatVnd } from '../../shared/format/currency';
import { formatDobDisplay } from '../../shared/format/date';
import { ReportPrintAction } from '../../shared/print/ReportPrintAction';
import { Button } from '../../shared/ui/Button';
import { useShowBranchInfo } from '../branch/BranchChip';
import { LabPartnerStatementTable } from './LabPartnerStatementTable';
import { buildLabPartnerStatementPrintSpec, statementHasMultipleBranches } from './lab-partner-statement-model';
import { useLabPartnerStatementQuery } from './lab-partner.queries';

/**
 * Phụ lục bảng kê trong hộp "Lập biên bản đối chiếu" (docs/DECISIONS.md #291 GĐ4, mockup màn 7): bảng kê mẫu gửi của kỳ đối chiếu (từ sau mốc chốt gần nhất đến ngày đối chiếu, tính theo
 * ngày nhận kết quả) để đối chiếu từng mẫu với đối tác. Có "Xem" (mở bảng ngay trong hộp) và "In". Phần E vẫn chỉ đối chiếu SỐ DƯ — phụ lục không đổi số liệu chốt.
 * Nhận kỳ và thông tin đối tác qua props; lỗi tải chỉ báo tại chỗ, không chặn việc lập biên bản.
 */
export function LabPartnerStatementAppendix({
  supplierId,
  supplierCode,
  supplierName,
  from,
  to,
}: {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  /** Đầu kỳ (`YYYY-MM-DD`); rỗng = từ đầu. */
  from: string;
  /** Ngày đối chiếu (`YYYY-MM-DD`). */
  to: string;
}) {
  const showBranchInfo = useShowBranchInfo();
  const [open, setOpen] = useState(false);
  const valid = to !== '' && (from === '' || from <= to);
  const query = useLabPartnerStatementQuery(supplierId, { basis: 'RECEIVED', status: 'ALL', ...(from ? { from } : {}), ...(to ? { to } : {}) }, valid);
  const data = query.data;
  const printSpec = useMemo(() => (data ? buildLabPartnerStatementPrintSpec(data, { supplierCode, supplierName, from, to, basis: 'RECEIVED' }) : null), [data, supplierCode, supplierName, from, to]);

  if (!valid) return null;
  if (query.isError) {
    return (
      <div className="rounded-md border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
        Không tải được bảng kê mẫu gửi.{' '}
        <button type="button" className="font-semibold text-blue-700 underline" onClick={() => void query.refetch()}>
          Thử lại
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-sm font-medium text-slate-500">Đang tải bảng kê mẫu gửi...</p>;

  const { summary } = data;
  const extra = [
    summary.waitingCount > 0 ? `Chờ kết quả ${summary.waitingCount} mẫu (${formatVnd(summary.waitingAmount)})` : null,
    summary.rejectedCount > 0 ? `không nhận ${summary.rejectedCount} mẫu` : null,
  ].filter((v): v is string => v !== null);

  return (
    <div className="rounded-md border border-slate-300 bg-slate-100 px-4 py-3" role="region" aria-label="Phụ lục bảng kê mẫu gửi đối tác">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold text-slate-800">
          Bảng kê {from ? `từ ${formatDobDisplay(from)} ` : ''}đến {formatDobDisplay(to)}: {summary.doneCount} mẫu đã có kết quả = {formatVnd(summary.doneAmount)}.
          {extra.length > 0 ? ` ${extra.join(', ')}, chưa tính vào nợ.` : ''}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Ẩn' : 'Xem'}
          </Button>
          <ReportPrintAction spec={printSpec} label="In" />
        </div>
      </div>
      {data.truncated && <p className="mt-2 text-xs font-semibold text-amber-800">Kỳ có rất nhiều mẫu, chỉ hiện phần đầu.</p>}
      {open && (
        <div className="mt-3 max-h-64 overflow-y-auto">
          {data.items.length === 0 ? (
            <p className="text-sm font-medium text-slate-600">Không có mẫu nào trong kỳ.</p>
          ) : (
            <LabPartnerStatementTable items={data.items} summary={summary} showBranch={showBranchInfo && statementHasMultipleBranches(data.items)} />
          )}
        </div>
      )}
    </div>
  );
}
