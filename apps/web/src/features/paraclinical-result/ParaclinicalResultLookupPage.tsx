import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, MagnifyingGlass, Printer, ListMagnifyingGlass } from '@phosphor-icons/react';
import type { ParaclinicalLookupRow, ParaclinicalLookupStatus } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { formatClockTime } from '../../shared/format/time';
import { PrintButton } from '../../shared/print/PrintButton';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { findCurrentBranch, hasMultipleBranches } from '../branch/branch-visibility';
import { LOOKUP_STATUS_OPTIONS, lookupStatusBadge, lookupSummaryBadge } from '../clinical-order/clinical-order-book-labels';
import { addDaysToDateString, formatDateStringVi, toVietnamDateString } from '../encounter/follow-up-date';
import { PARACLINICAL_GROUP_META, type ParaclinicalGroup } from './paraclinical-group';
import { genderShort } from './paraclinical-result-labels';
import { useParaclinicalLookupQuery } from './paraclinical-result.queries';
import { ParaclinicalResultQuickPrint } from './ParaclinicalResultQuickPrint';
import { ParaclinicalResultViewDialog } from './ParaclinicalResultViewDialog';
import { useCanViewResultContent } from './useCanViewResultContent';

const COLUMN_WIDTHS = [130, 220, null, 130, 170, 140, 180, 100] as const;

/**
 * Menu "Cận lâm sàng › Tra cứu kết quả" (docs/DECISIONS.md #232, mockup 14c đã duyệt): kết quả ĐÃ DUYỆT theo khoảng ngày (mặc định 7 ngày gần nhất), xem + in lại. Hai tab theo quyền — có
 * `lab_result.read` thấy "Xét nghiệm", có `imaging_result.read` thấy "CĐHA & Thăm dò chức năng". Lễ tân chỉ xem danh sách và In (không mở nội dung — nút "Xem" chỉ cho người làm chuyên môn có quyền
 * Nhập/Duyệt). THEO CHI NHÁNH: chỉ kết quả của chi nhánh đang làm việc; xem kết quả bệnh nhân ở chi nhánh khác qua hồ sơ bệnh nhân.
 */
export function ParaclinicalResultLookupPage() {
  useBreadcrumb([{ label: 'Cận lâm sàng' }, { label: 'Tra cứu kết quả' }]);

  const canLab = useHasPermission('lab_result', 'read');
  const canImaging = useHasPermission('imaging_result', 'read');
  const tabs = useMemo(
    () => [...(canLab ? [{ id: 'lab' as const, label: PARACLINICAL_GROUP_META.lab.label }] : []), ...(canImaging ? [{ id: 'imaging' as const, label: PARACLINICAL_GROUP_META.imaging.label }] : [])],
    [canLab, canImaging],
  );
  const [chosenGroup, setChosenGroup] = useState<ParaclinicalGroup>(canLab ? 'lab' : 'imaging');
  // Quyền có thể đổi sau khi mở trang; tab đang chọn không còn quyền → rơi về tab còn lại.
  const group: ParaclinicalGroup = tabs.some((t) => t.id === chosenGroup) ? chosenGroup : (tabs[0]?.id ?? 'lab');
  const canViewContent = useCanViewResultContent(group);

  const today = useMemo(() => toVietnamDateString(new Date().toISOString()), []);
  const [dateFrom, setDateFrom] = useState(() => addDaysToDateString(today, -6) ?? today);
  const [dateTo, setDateTo] = useState(today);
  const [status, setStatus] = useState<ParaclinicalLookupStatus | ''>('');
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);

  const [viewing, setViewing] = useState<ParaclinicalLookupRow | null>(null);
  const [printJob, setPrintJob] = useState<{ itemId: string; group: ParaclinicalGroup; nonce: number } | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const nonceRef = useRef(0);

  const user = useAuthStore((s) => s.user);
  const branchName = hasMultipleBranches(user) ? (findCurrentBranch(user)?.name ?? null) : null;

  const query = useParaclinicalLookupQuery(
    group,
    { dateFrom, dateTo, status: status || undefined, abnormalOnly: group === 'lab' && abnormalOnly, q: q || undefined },
    tabs.length > 0,
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { root, rootMargin: '120px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  const startPrint = useCallback((row: ParaclinicalLookupRow) => {
    setPrintError(null);
    nonceRef.current += 1;
    setPrintJob({ itemId: row.key, group, nonce: nonceRef.current });
  }, [group]);
  const endPrint = useCallback(() => setPrintJob(null), []);
  const failPrint = useCallback((message: string) => {
    setPrintError(message);
    setPrintJob(null);
  }, []);

  if (tabs.length === 0) {
    return (
      <div className="p-5">
        <h1 className="sr-only">Tra cứu kết quả</h1>
        <EmptyState icon={ListMagnifyingGlass} title="Chưa có nhóm kết quả nào để tra cứu" description="Tài khoản của bạn chưa được cấp quyền xem kết quả Xét nghiệm hoặc CĐHA & Thăm dò chức năng." />
      </div>
    );
  }

  const hasFilter = q !== '' || status !== '' || abnormalOnly;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-5">
      <h1 className="sr-only">Tra cứu kết quả cận lâm sàng</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedToggle items={tabs} value={group} onChange={setChosenGroup} ariaLabel="Nhóm kết quả" />
        <span className="text-xs font-medium text-slate-500">Tab hiện theo quyền: có quyền xem Xét nghiệm / CĐHA nào thì thấy tab đó.</span>
      </div>

      <div className="flex flex-wrap items-end gap-2.5">
        <div className="flex items-center gap-2">
          <label htmlFor="prl-date-from" className="text-sm font-semibold text-slate-800">
            Từ
          </label>
          <div className="w-40">
            <DateInput id="prl-date-from" value={dateFrom} onChange={(v) => v && setDateFrom(v)} dense />
          </div>
          <label htmlFor="prl-date-to" className="text-sm font-semibold text-slate-800">
            đến
          </label>
          <div className="w-40">
            <DateInput id="prl-date-to" value={dateTo} onChange={(v) => v && setDateTo(v)} dense />
          </div>
        </div>
        <div className="relative w-72">
          <MagnifyingGlass size={15} weight="regular" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tên bệnh nhân, mã BN, mã phiếu…"
            aria-label="Tìm kết quả"
            className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-[13px] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <div className="w-44">
          <Combobox id="prl-status" value={status} onChange={(v) => setStatus(v as ParaclinicalLookupStatus | '')} options={LOOKUP_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} placeholder="Mọi trạng thái" dense />
        </div>
        {group === 'lab' && (
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={abnormalOnly} onChange={(e) => setAbnormalOnly(e.target.checked)} className="h-4 w-4" />
            Chỉ kết quả có chỉ số bất thường
          </label>
        )}
      </div>

      {printError && <ErrorBanner message={printError} />}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div ref={scrollRef} className="scroll-hover min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm" style={{ minWidth: 1100, tableLayout: 'fixed' }}>
            <colgroup>
              {COLUMN_WIDTHS.map((w, i) => (
                <col key={i} style={w ? { width: w } : undefined} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                <th className="px-3 py-2.5 text-center">Mã phiếu</th>
                <th className="px-3 py-2.5 text-left">Bệnh nhân</th>
                <th className="px-3 py-2.5 text-left">Dịch vụ</th>
                <th className="px-3 py-2.5 text-center">Thực hiện lúc</th>
                <th className="px-3 py-2.5 text-center">Người duyệt</th>
                <th className="px-3 py-2.5 text-center">Trạng thái</th>
                <th className="px-3 py-2.5 text-center">Kết quả</th>
                <th className="px-3 py-2.5 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const statusBadge = lookupStatusBadge(row.status);
                const summary = lookupSummaryBadge(row.summary, row.abnormalCount);
                return (
                  <tr key={row.key} className="h-[60px] border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 text-center font-semibold text-slate-800">{row.orderNo}</td>
                    <td className="px-3 text-left">
                      <div className="truncate font-semibold text-slate-900">{row.patientName}</div>
                      <div className="truncate text-xs font-medium text-slate-500">
                        {row.patientCode} · {row.ageYears ?? '—'} · {genderShort(row.gender)}
                      </div>
                    </td>
                    <td className="px-3 text-left">
                      <div className="truncate font-medium text-slate-800" title={row.serviceNames.join(', ')}>
                        {row.serviceNames.join(', ')}
                      </div>
                      <div className="text-xs font-medium text-slate-500">
                        {row.serviceCount} dịch vụ {group === 'lab' ? 'xét nghiệm' : 'CĐHA & thăm dò'}
                      </div>
                    </td>
                    <td className="px-3 text-center">
                      <div className="font-medium tabular-nums text-slate-700">{formatClockTime(row.signedAt)}</div>
                      <div className="text-xs font-medium tabular-nums text-slate-500">{formatDateStringVi(toVietnamDateString(row.signedAt))}</div>
                    </td>
                    <td className="px-3 text-center font-medium text-slate-700">
                      <div className="truncate">{row.signedByName ?? '—'}</div>
                    </td>
                    <td className="px-3 text-center">
                      <StatusBadge tone={statusBadge.tone}>{statusBadge.label}</StatusBadge>
                    </td>
                    <td className="px-3 text-center">{summary ? <StatusBadge tone={summary.tone}>{summary.label}</StatusBadge> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {canViewContent && <RowActionButton icon={Eye} label="Xem kết quả" tone="primary" onClick={() => setViewing(row)} />}
                        <PrintButton
                          documentType={group === 'lab' ? 'LAB_RESULT' : 'IMAGING_RESULT'}
                          onPrint={() => startPrint(row)}
                          renderTrigger={({ onClick, disabled }) => <RowActionButton icon={Printer} label="In kết quả" tone="neutral" onClick={onClick} disabled={disabled} />}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {query.isPending && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {query.isError && (
            <div className="p-4">
              <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được danh sách kết quả.'} onRetry={() => void query.refetch()} />
            </div>
          )}
          {query.isSuccess && items.length === 0 && (
            <div className="p-6">
              <EmptyState
                icon={ListMagnifyingGlass}
                title={hasFilter ? 'Không có kết quả nào khớp bộ lọc' : 'Chưa có kết quả đã duyệt trong khoảng ngày này'}
                description={hasFilter ? 'Thử bỏ bớt bộ lọc, hoặc đổi khoảng ngày.' : 'Đổi khoảng ngày ở trên để tra kết quả cũ hơn.'}
              />
            </div>
          )}
          {hasNextPage && (
            <div ref={sentinelRef} className="px-3 py-3 text-center text-xs font-medium text-slate-500">
              {isFetchingNextPage ? 'Đang tải thêm…' : ' '}
            </div>
          )}
        </div>
        <div className="border-t border-slate-100 py-2.5 text-center text-xs font-medium text-slate-500">Cuộn xuống tự tải thêm · Mặc định 7 ngày gần nhất</div>
      </div>

      <p className="text-xs font-medium text-slate-500">
        {branchName ? `Chỉ hiện kết quả của chi nhánh đang làm việc (${branchName}). ` : ''}Muốn xem kết quả bệnh nhân đã làm ở chi nhánh khác: mở hồ sơ bệnh nhân đó (tab Lịch sử khám, khối “Kết quả đã có”).
      </p>

      {viewing && <ParaclinicalResultViewDialog group={group} itemId={viewing.key} onClose={() => setViewing(null)} />}
      {printJob && <ParaclinicalResultQuickPrint key={printJob.nonce} group={printJob.group} itemId={printJob.itemId} onDone={endPrint} onError={failPrint} />}
    </div>
  );
}
