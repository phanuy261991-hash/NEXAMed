import { useMemo, useState } from 'react';
import { DownloadSimple, TestTube } from '@phosphor-icons/react';
import { formatDobDisplay } from '../../shared/format/date';
import { toVnDateAndTime } from '../../shared/format/time';
import { ReportPrintAction } from '../../shared/print/ReportPrintAction';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useShowBranchInfo } from '../branch/BranchChip';
import { useExportLabPartnerStatementMutation } from '../report/report-exports';
import { useLabPartnerStatementQuery } from './lab-partner.queries';
import { LabPartnerStatementTable } from './LabPartnerStatementTable';
import {
  STATEMENT_STATUS_OPTIONS,
  buildLabPartnerStatementPrintSpec,
  statementHasMultipleBranches,
  type StatementBasis,
  type StatementStatusFilter,
} from './lab-partner-statement-model';

/** Ngày đầu tháng và hôm nay (giờ Việt Nam, `YYYY-MM-DD`) — kỳ mặc định của bảng kê. */
function defaultPeriod(): { from: string; to: string } {
  const today = toVnDateAndTime().date;
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * Tab "Mẫu đã gửi" ở trang chi tiết đối tác xét nghiệm = bảng kê mẫu gửi (docs/DECISIONS.md #291 GĐ4, mockup màn 6): mỗi dòng một dịch vụ, kỳ tính theo ngày nhận kết quả (mặc định) hoặc ngày gửi,
 * dòng Cộng chỉ gồm mẫu đã có kết quả (= số phát sinh công nợ); mẫu chờ kết quả là "dự kiến", không nhận là 0 đ. Có Xuất Excel và In (mọi báo cáo đều có cả hai, #287).
 * Nhận mã/tên đối tác qua tham số để dùng cho đầu bản in; không biết gì về trang chứa nó.
 */
export function LabPartnerStatementTab({ supplierId, supplierCode, supplierName }: { supplierId: string; supplierCode: string; supplierName: string }) {
  const showBranchInfo = useShowBranchInfo();
  const initial = useMemo(defaultPeriod, []);
  const [basis, setBasis] = useState<StatementBasis>('RECEIVED');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [status, setStatus] = useState<StatementStatusFilter>('ALL');
  const rangeError = from !== '' && to !== '' && from > to ? 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.' : null;
  const query = useLabPartnerStatementQuery(supplierId, { basis, status, ...(from ? { from } : {}), ...(to ? { to } : {}) }, rangeError === null);
  const exportMutation = useExportLabPartnerStatementMutation();
  const data = query.data;
  const printSpec = useMemo(
    () => (data && rangeError === null ? buildLabPartnerStatementPrintSpec(data, { supplierCode, supplierName, from, to, basis }) : null),
    [data, rangeError, supplierCode, supplierName, from, to, basis],
  );
  const actionsDisabled = rangeError !== null || query.isLoading || query.isError || !data;
  const hasPeriod = from !== '' || to !== '';
  const filtered = hasPeriod || status !== 'ALL';

  const toolbar = (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <SegmentedToggle
          ariaLabel="Tính kỳ theo"
          value={basis}
          onChange={setBasis}
          items={[
            { id: 'SENT', label: 'Ngày gửi' },
            { id: 'RECEIVED', label: 'Ngày nhận kết quả' },
          ]}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lps-from" className="text-sm font-semibold text-slate-800">
            Từ ngày
          </label>
          <div className="w-40">
            <DateInput id="lps-from" value={from} onChange={setFrom} dense />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lps-to" className="text-sm font-semibold text-slate-800">
            Đến ngày
          </label>
          <div className="w-40">
            <DateInput id="lps-to" value={to} onChange={setTo} dense />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lps-status" className="text-sm font-semibold text-slate-800">
            Trạng thái
          </label>
          <div className="w-48">
            <Combobox id="lps-status" value={status} onChange={(v) => setStatus(v as StatementStatusFilter)} options={STATEMENT_STATUS_OPTIONS} dense floating />
          </div>
        </div>
        {filtered && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setFrom('');
              setTo('');
              setStatus('ALL');
            }}
          >
            Xoá lọc
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={actionsDisabled}
          loading={exportMutation.isPending}
          onClick={() => exportMutation.mutate({ supplierId, basis, status, ...(from ? { from } : {}), ...(to ? { to } : {}) })}
        >
          <DownloadSimple size={16} weight="bold" aria-hidden="true" />
          Xuất Excel
        </Button>
        <ReportPrintAction spec={printSpec} disabled={actionsDisabled} label="In bảng kê" />
      </div>
    </div>
  );

  if (query.isError) {
    return (
      <>
        {toolbar}
        <ErrorBanner message="Không tải được bảng kê mẫu đã gửi." onRetry={() => query.refetch()} />
      </>
    );
  }

  const items = data?.items ?? [];
  const summary = data?.summary;
  const showBranch = showBranchInfo && statementHasMultipleBranches(items);

  return (
    <div>
      {toolbar}
      {rangeError && <ErrorBanner message={rangeError} />}
      {exportMutation.isError && <ErrorBanner message="Không xuất được Excel. Thử lại sau." />}
      {query.isLoading && !rangeError && <Skeleton className="h-40 w-full" />}
      {data?.truncated && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
          Kỳ này có rất nhiều mẫu, bảng chỉ hiện phần đầu. Thu hẹp khoảng ngày để xem đủ.
        </div>
      )}
      {items.length === 0 && query.isSuccess && !rangeError && (
        <EmptyState
          icon={TestTube}
          title={filtered ? 'Không có mẫu nào khớp bộ lọc' : 'Chưa gửi mẫu nào cho đối tác này'}
          description={filtered ? `${hasPeriod ? `Kỳ ${from ? formatDobDisplay(from) : 'đầu'} – ${to ? formatDobDisplay(to) : 'nay'}. ` : ''}Thử đổi khoảng ngày, trạng thái hoặc xoá lọc.` : 'Mẫu gửi từ "Gửi mẫu đối tác" sẽ hiện ở đây.'}
        />
      )}
      {items.length > 0 && !rangeError && summary && <LabPartnerStatementTable items={items} summary={summary} showBranch={showBranch} />}
    </div>
  );
}
