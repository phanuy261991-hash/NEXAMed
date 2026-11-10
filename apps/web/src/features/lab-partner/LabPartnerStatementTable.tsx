import type { LabPartnerStatementRow, LabPartnerStatementSummary } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';
import { formatDateTimeVn } from '../../shared/format/time';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatTurnaround, statementStateView } from './lab-partner-statement-model';

/**
 * Bảng kê mẫu gửi đối tác (docs/DECISIONS.md #291 GĐ4): mỗi dòng một dịch vụ, dòng Cộng chỉ gồm mẫu đã có kết quả. Chỉ vẽ bảng — nhận dòng + tổng qua props nên dùng lại được ở tab "Mẫu đã gửi"
 * và phụ lục của biên bản đối chiếu. `showBranch` do nơi gọi quyết định (chỉ khi công ty có từ 2 chi nhánh).
 */
export function LabPartnerStatementTable({
  items,
  summary,
  showBranch,
}: {
  items: readonly LabPartnerStatementRow[];
  summary: Pick<LabPartnerStatementSummary, 'doneCount' | 'doneAmount' | 'waitingCount' | 'rejectedCount'>;
  showBranch: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
            <th className="px-3 py-2.5 text-center">Mã ống</th>
            <th className="px-3 py-2.5 text-left">Bệnh nhân</th>
            <th className="px-3 py-2.5 text-left">Dịch vụ</th>
            {showBranch && <th className="px-3 py-2.5 text-center">Chi nhánh</th>}
            <th className="px-3 py-2.5 text-center">Gửi lúc</th>
            <th className="px-3 py-2.5 text-center">Nhận kết quả lúc</th>
            <th className="px-3 py-2.5 text-center">Thời gian trả</th>
            <th className="px-3 py-2.5 text-right">Giá trả (đ)</th>
            <th className="px-3 py-2.5 text-center">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const view = statementStateView(r);
            const rejected = r.state === 'REJECTED';
            return (
              <tr key={r.itemId} className={`border-b border-slate-200 ${rejected ? 'bg-slate-50 text-slate-500' : ''}`}>
                <td className="px-3 py-2 text-center text-xs font-semibold text-slate-700">{r.tubeSid ?? '—'}</td>
                <td className="px-3 py-2 text-left">
                  <div className="font-semibold text-slate-900">{r.patientName}</div>
                  <div className="text-xs text-slate-500">{r.patientCode}</div>
                </td>
                <td className="px-3 py-2 text-left font-medium text-slate-700">{r.serviceName}</td>
                {showBranch && <td className="px-3 py-2 text-center text-xs font-medium text-slate-600">{r.branchName ?? '—'}</td>}
                <td className="px-3 py-2 text-center text-xs font-medium tabular-nums text-slate-700">{formatDateTimeVn(r.sentAt)}</td>
                <td className="px-3 py-2 text-center text-xs font-medium tabular-nums text-slate-700">{r.receivedAt ? formatDateTimeVn(r.receivedAt) : '—'}</td>
                <td className={`px-3 py-2 text-center text-xs font-medium ${r.late && r.state === 'DONE' ? 'font-semibold text-rose-700' : 'text-slate-700'}`}>
                  {formatTurnaround(r.turnaroundMinutes)}
                  {r.late && r.state === 'DONE' && <div className="text-[11px] font-semibold text-rose-700">Quá hạn</div>}
                </td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.state === 'DONE' ? 'text-slate-900' : 'text-slate-400'}`}>
                  {formatVnd(r.amount)}
                  {r.state === 'WAITING' && <div className="text-[11px] font-medium text-slate-500">dự kiến</div>}
                </td>
                <td className="px-3 py-2 text-center" title={r.rejectReason ?? undefined}>
                  <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-100 text-sm font-semibold text-slate-800">
            <td className="px-3 py-2.5 text-left" colSpan={showBranch ? 6 : 5}>
              Cộng đã có kết quả: {summary.doneCount} mẫu · chờ kết quả: {summary.waitingCount} mẫu · không nhận: {summary.rejectedCount} mẫu
            </td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-right tabular-nums">{formatVnd(summary.doneAmount)}</td>
            <td className="px-3 py-2.5" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
