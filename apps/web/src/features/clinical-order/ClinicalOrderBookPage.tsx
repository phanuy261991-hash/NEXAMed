import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardText, Eye, MagnifyingGlass, Printer } from '@phosphor-icons/react';
import type { ClinicalOrderListGroup, ClinicalOrderListProgress, ClinicalOrderListRow } from '@nexamed/shared';
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
import { useDoctorsQuery } from '../appointment/appointment.queries';
import { useAuthStore } from '../auth/auth.store';
import { findCurrentBranch, hasMultipleBranches } from '../branch/branch-visibility';
import { formatDateStringVi, toVietnamDateString } from '../encounter/follow-up-date';
import { genderShort } from '../paraclinical-result/paraclinical-result-labels';
import { ClinicalOrderDetailDialog } from './ClinicalOrderDetailDialog';
import { ClinicalOrderQuickPrint } from './ClinicalOrderQuickPrint';
import { ORDER_GROUP_TABS, ORDER_PAYMENT_BADGE, ORDER_PROGRESS_FILTERS, orderGroupCountLabel, orderProgressBadge } from './clinical-order-book-labels';
import { useClinicalOrderBookQuery } from './clinical-order.queries';

/** Cột cố định (px) — `table-layout: fixed` để cột không bị bóp theo nội dung; cột "Dịch vụ chỉ định" nhận phần rộng còn lại. */
const COLUMN_WIDTHS = [130, 220, null, 160, 100, 170, 110, 100] as const;

/**
 * Menu "Cận lâm sàng › Phiếu chỉ định" (docs/DECISIONS.md #232, mockup 14a đã duyệt): sổ tra cứu MỌI phiếu chỉ định theo ngày, chia 3 nhóm — Xét nghiệm / CĐHA & Thăm dò chức năng / Chỉ định ra ngoài.
 * CHỈ XEM và in lại (thực hiện, lấy mẫu, nhập kết quả ở hàng đợi). Dữ liệu THEO CHI NHÁNH: chỉ phiếu của chi nhánh đang làm việc. Mặc định hôm nay; cuộn xuống tự tải thêm (cursor).
 */
export function ClinicalOrderBookPage() {
  useBreadcrumb([{ label: 'Cận lâm sàng' }, { label: 'Phiếu chỉ định' }]);

  const today = useMemo(() => toVietnamDateString(new Date().toISOString()), []);
  const [group, setGroup] = useState<ClinicalOrderListGroup>('LAB');
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [doctorId, setDoctorId] = useState('');
  const [progress, setProgress] = useState<ClinicalOrderListProgress | ''>('');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);

  const [viewing, setViewing] = useState<ClinicalOrderListRow | null>(null);
  const [printJob, setPrintJob] = useState<{ row: ClinicalOrderListRow; nonce: number } | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const nonceRef = useRef(0);

  const user = useAuthStore((s) => s.user);
  const branchName = hasMultipleBranches(user) ? (findCurrentBranch(user)?.name ?? null) : null;
  const doctorsQuery = useDoctorsQuery();
  const doctorOptions = useMemo(
    () => [{ value: '', label: 'Tất cả bác sĩ' }, ...(doctorsQuery.data?.items ?? []).map((d) => ({ value: d.id, label: d.displayName ?? d.fullName }))],
    [doctorsQuery.data],
  );

  const query = useClinicalOrderBookQuery({
    group,
    dateFrom,
    dateTo,
    doctorId: doctorId || undefined,
    // Nhóm "Chỉ định ra ngoài" không có tiến độ nên bỏ bộ lọc này.
    progress: group === 'EXTERNAL' ? undefined : progress || undefined,
    q: q || undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  // Cuộn tới đâu tự tải thêm tới đó: phần tử đệm cuối bảng, quan sát trong chính khung cuộn.
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

  const startPrint = useCallback((row: ClinicalOrderListRow) => {
    setPrintError(null);
    nonceRef.current += 1;
    setPrintJob({ row, nonce: nonceRef.current });
  }, []);
  const endPrint = useCallback(() => setPrintJob(null), []);
  const failPrint = useCallback((message: string) => {
    setPrintError(message);
    setPrintJob(null);
  }, []);

  const hasFilter = q !== '' || doctorId !== '' || progress !== '';

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-5">
      <h1 className="sr-only">Phiếu chỉ định cận lâm sàng</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedToggle items={ORDER_GROUP_TABS} value={group} onChange={setGroup} ariaLabel="Nhóm dịch vụ" />
        <span className="text-xs font-medium text-slate-500">Phiếu có cả xét nghiệm và CĐHA hiện ở cả hai tab, mỗi tab chỉ liệt kê dịch vụ thuộc nhóm đó.</span>
      </div>

      <div className="flex flex-wrap items-end gap-2.5">
        <div className="flex items-center gap-2">
          <label htmlFor="cob-date-from" className="text-sm font-semibold text-slate-800">
            Từ
          </label>
          <div className="w-40">
            <DateInput id="cob-date-from" value={dateFrom} onChange={(v) => v && setDateFrom(v)} dense />
          </div>
          <label htmlFor="cob-date-to" className="text-sm font-semibold text-slate-800">
            đến
          </label>
          <div className="w-40">
            <DateInput id="cob-date-to" value={dateTo} onChange={(v) => v && setDateTo(v)} dense />
          </div>
        </div>
        <div className="w-52">
          <Combobox id="cob-doctor" value={doctorId} onChange={setDoctorId} options={doctorOptions} placeholder="Tất cả bác sĩ" dense />
        </div>
        <div className="relative w-72">
          <MagnifyingGlass size={15} weight="regular" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tên, mã BN, mã phiếu…"
            aria-label="Tìm phiếu chỉ định"
            className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-[13px] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      {group !== 'EXTERNAL' && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo tiến độ">
          {ORDER_PROGRESS_FILTERS.map((f) => (
            <button
              key={f.id || 'all'}
              type="button"
              aria-pressed={progress === f.id}
              onClick={() => setProgress(f.id)}
              className={`rounded-full px-4 py-1.5 text-sm ${progress === f.id ? 'bg-blue-600 font-semibold text-white' : 'border border-slate-300 bg-white font-medium text-slate-600 hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {printError && <ErrorBanner message={printError} />}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div ref={scrollRef} className="scroll-hover min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm" style={{ minWidth: 1080, tableLayout: 'fixed' }}>
            <colgroup>
              {COLUMN_WIDTHS.map((w, i) => (
                <col key={i} style={w ? { width: w } : undefined} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                <th className="px-3 py-2.5 text-center">Mã phiếu</th>
                <th className="px-3 py-2.5 text-left">Bệnh nhân</th>
                <th className="px-3 py-2.5 text-left">Dịch vụ chỉ định</th>
                <th className="px-3 py-2.5 text-left">Bác sĩ chỉ định</th>
                <th className="px-3 py-2.5 text-center">Chỉ định lúc</th>
                <th className="px-3 py-2.5 text-center">Tiến độ</th>
                <th className="px-3 py-2.5 text-center">Thanh toán</th>
                <th className="px-3 py-2.5 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const progressBadge = orderProgressBadge(row.progress);
                const payment = ORDER_PAYMENT_BADGE[row.payment];
                return (
                  <tr key={row.orderId} className="h-[60px] border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 text-center font-semibold text-slate-800">{row.orderNo}</td>
                    <td className="px-3 text-left">
                      <div className="truncate font-semibold text-slate-900">{row.patientName}</div>
                      <div className="truncate text-xs font-medium text-slate-500">
                        {row.patientCode} · {row.ageYears ?? '—'} · {genderShort(row.patientGender === 'male' || row.patientGender === 'female' || row.patientGender === 'other' ? row.patientGender : null)}
                      </div>
                    </td>
                    <td className="px-3 text-left">
                      <div className="truncate font-medium text-slate-800" title={row.serviceNames.join(', ')}>
                        {row.serviceNames.join(', ')}
                      </div>
                      <div className="text-xs font-medium text-slate-500">{orderGroupCountLabel(group, row.serviceCount)}</div>
                    </td>
                    <td className="px-3 text-left font-medium text-slate-700">
                      <div className="truncate">{row.doctorName ?? '—'}</div>
                    </td>
                    <td className="px-3 text-center">
                      <div className="font-medium tabular-nums text-slate-700">{formatClockTime(row.orderedAt)}</div>
                      <div className="text-xs font-medium tabular-nums text-slate-500">{formatDateStringVi(toVietnamDateString(row.orderedAt))}</div>
                    </td>
                    <td className="px-3 text-center">
                      <StatusBadge tone={progressBadge.tone}>{progressBadge.label}</StatusBadge>
                    </td>
                    <td className="px-3 text-center">
                      <StatusBadge tone={payment.tone}>{payment.label}</StatusBadge>
                    </td>
                    <td className="px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <RowActionButton icon={Eye} label="Xem phiếu chỉ định" tone="primary" onClick={() => setViewing(row)} />
                        <PrintButton
                          documentType="CLINICAL_ORDER"
                          onPrint={() => startPrint(row)}
                          renderTrigger={({ onClick, disabled }) => <RowActionButton icon={Printer} label="In phiếu chỉ định" tone="neutral" onClick={onClick} disabled={disabled} />}
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
              <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được danh sách phiếu chỉ định.'} onRetry={() => void query.refetch()} />
            </div>
          )}
          {query.isSuccess && items.length === 0 && (
            <div className="p-6">
              <EmptyState
                icon={ClipboardText}
                title={hasFilter ? 'Không có phiếu nào khớp bộ lọc' : 'Chưa có phiếu chỉ định nào trong khoảng ngày này'}
                description={hasFilter ? 'Thử bỏ bớt bộ lọc, hoặc đổi khoảng ngày.' : 'Đổi khoảng ngày ở trên để tra phiếu cũ hơn.'}
              />
            </div>
          )}
          {hasNextPage && (
            <div ref={sentinelRef} className="px-3 py-3 text-center text-xs font-medium text-slate-500">
              {isFetchingNextPage ? 'Đang tải thêm…' : ' '}
            </div>
          )}
        </div>
        <div className="border-t border-slate-100 py-2.5 text-center text-xs font-medium text-slate-500">
          Cuộn xuống tự tải thêm · Mặc định hiện phiếu của hôm nay, đổi khoảng ngày để tra phiếu cũ
        </div>
      </div>

      {branchName && <p className="text-xs font-medium text-slate-500">Chỉ hiện phiếu của chi nhánh đang làm việc ({branchName}). Đổi chi nhánh ở thanh trên để xem phiếu của nơi khác.</p>}

      {viewing && <ClinicalOrderDetailDialog row={viewing} onClose={() => setViewing(null)} />}
      {printJob && <ClinicalOrderQuickPrint key={printJob.nonce} row={printJob.row} onDone={endPrint} onError={failPrint} />}
    </div>
  );
}
