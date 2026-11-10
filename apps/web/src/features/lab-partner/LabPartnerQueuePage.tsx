import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, DownloadSimple, Flask, MagnifyingGlass, PaperPlaneTiltIcon, Prohibit, Warning } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import type { LabPartnerDoneRow, LabPartnerPendingRow, LabPartnerSentRow, ReceiveLabPartnerResultResponse, SendLabPartnerSamplesResponse } from '@nexamed/shared';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { formatVnd } from '../../shared/format/currency';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionMenu } from '../../shared/ui/RowActionMenu';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useHasPermission } from '../auth/usePermission';
import { useLabPartnerEnabledQuery } from '../clinic/clinic.queries';
import { formatWaitDuration, isLongWait } from '../paraclinical-result/paraclinical-result-labels';
import { LabPartnerReceiveDialog } from './LabPartnerReceiveDialog';
import { LabPartnerResultDialog } from './LabPartnerResultDialog';
import { LabPartnerSendDialog } from './LabPartnerSendDialog';
import { useLabPartnerDoneQuery, useLabPartnerPendingQuery, useLabPartnerSentQuery, useRejectLabPartnerItemMutation } from './lab-partner.queries';
import { defaultOptionOf } from './lab-partner-send-model';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';

type Tab = 'pending' | 'sent' | 'done';
type DoneFilter = 'PENDING' | 'APPROVED' | 'ALL';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'pending', label: 'Chờ gửi' },
  { key: 'sent', label: 'Đã gửi chờ kết quả' },
  { key: 'done', label: 'Đã có kết quả' },
];
const DONE_FILTERS: Array<{ key: DoneFilter; label: string }> = [
  { key: 'PENDING', label: 'Chờ duyệt' },
  { key: 'APPROVED', label: 'Đã duyệt' },
  { key: 'ALL', label: 'Tất cả' },
];

const ROW_MIN_HEIGHT = 56;

const pendingGrid = (selectable: boolean, cost: boolean) => `${selectable ? '34px ' : ''}120px minmax(150px,1.2fr) minmax(150px,1.2fr) 110px 120px ${cost ? 'minmax(190px,1.2fr)' : 'minmax(170px,1.2fr)'} 90px`;
const sentGrid = (selectable: boolean, cost: boolean) => `${selectable ? '34px ' : ''}120px minmax(150px,1.2fr) minmax(150px,1.2fr) minmax(150px,1fr) 130px 130px 120px${cost ? ' 110px' : ''} 190px`;
const doneGrid = (cost: boolean) => `120px minmax(150px,1.2fr) minmax(150px,1.2fr) minmax(140px,1fr) 120px 120px 110px${cost ? ' 110px' : ''} 130px 150px`;

/**
 * Hàng đợi "Gửi mẫu đối tác" (menu Cận lâm sàng, mockup màn 2–5, docs/DECISIONS.md #291): mẫu xét nghiệm đã lấy của dịch vụ cấu hình "Gửi đối tác" → chọn đối tác, áp giá trả → theo dõi hạn trả
 * → NHẬN kết quả PDF (một tệp cho nhiều dịch vụ, ghi nợ đối tác) → bác sĩ xem PDF và DUYỆT. Tab "Đã có kết quả" mặc định lọc "Chờ duyệt" để bác sĩ thấy việc cần làm trước.
 * Tự làm mới 30 giây. Bảng dạng lưới: dòng tiêu đề và dòng dữ liệu dùng CÙNG cột và CÙNG khoảng cách (ui-guidelines mục 14).
 */
export function LabPartnerQueuePage() {
  useBreadcrumb([{ label: 'Cận lâm sàng' }, { label: 'Gửi mẫu đối tác' }]);
  const navigate = useNavigate();
  const enabledQuery = useLabPartnerEnabledQuery();
  const canSend = useHasPermission('lab_partner', 'send');
  const canReceive = useHasPermission('lab_partner', 'receive');
  const canApprove = useHasPermission('lab_result', 'approve');
  const [tab, setTab] = useState<Tab>('pending');
  const [doneFilter, setDoneFilter] = useState<DoneFilter>('PENDING');
  const [supplierId, setSupplierId] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedSent, setSelectedSent] = useState<Set<string>>(new Set());
  // Hộp nhận ẢNH CHỤP danh sách lúc bấm nút (danh sách tự làm mới 30 giây, không để dòng đổi dưới chân hộp đang mở).
  const [sendRows, setSendRows] = useState<LabPartnerPendingRow[] | null>(null);
  const [receiveRows, setReceiveRows] = useState<{ rows: LabPartnerSentRow[]; ids: Set<string> } | null>(null);
  const [rejectRow, setRejectRow] = useState<LabPartnerSentRow | null>(null);
  const [resultItemId, setResultItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rejectMutation = useRejectLabPartnerItemMutation();

  const params = useMemo(() => ({ ...(supplierId ? { supplierId } : {}), ...(debouncedSearch ? { q: debouncedSearch } : {}) }), [supplierId, debouncedSearch]);
  const pendingQuery = useLabPartnerPendingQuery(params);
  const sentQuery = useLabPartnerSentQuery(params, tab === 'sent');
  const doneQuery = useLabPartnerDoneQuery(params, tab === 'done');
  const costVisible = (tab === 'sent' ? sentQuery.data?.costVisible : tab === 'done' ? doneQuery.data?.costVisible : pendingQuery.data?.costVisible) ?? pendingQuery.data?.costVisible ?? false;
  const counts = pendingQuery.data?.counts ?? sentQuery.data?.counts ?? doneQuery.data?.counts;

  const byService = <T extends { serviceName: string }>(rows: T[] | undefined): T[] => (rows ?? []).filter((r) => serviceName === '' || r.serviceName === serviceName);
  const pendingRows = useMemo(() => byService(pendingQuery.data?.items), [pendingQuery.data, serviceName]); // eslint-disable-line react-hooks/exhaustive-deps
  const sentRows = useMemo(() => byService(sentQuery.data?.items), [sentQuery.data, serviceName]); // eslint-disable-line react-hooks/exhaustive-deps
  const doneAll = useMemo(() => byService(doneQuery.data?.items), [doneQuery.data, serviceName]); // eslint-disable-line react-hooks/exhaustive-deps
  // Chờ duyệt xếp trên (bác sĩ cần làm trước), trong nhóm giữ thứ tự mới nhận trước.
  const doneRows = useMemo(() => {
    const filtered = doneAll.filter((r) => doneFilter === 'ALL' || r.approval === doneFilter);
    return [...filtered].sort((a, b) => Number(a.approval === 'APPROVED') - Number(b.approval === 'APPROVED'));
  }, [doneAll, doneFilter]);
  const awaiting = doneAll.filter((r) => r.approval === 'PENDING').length;
  const openResult: LabPartnerDoneRow | null = resultItemId ? (doneAll.find((r) => r.itemId === resultItemId) ?? null) : null;
  const nextPending = openResult ? doneRows.find((r) => r.approval === 'PENDING' && r.itemId !== openResult.itemId) : undefined;

  // Mẫu rời danh sách (đã xử lý ở máy khác, hoặc danh sách làm mới) thì bỏ khỏi phần đã tích.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(pendingRows.map((r) => r.itemId));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pendingRows]);
  useEffect(() => {
    setSelectedSent((prev) => {
      const ids = new Set(sentRows.map((r) => r.itemId));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [sentRows]);

  const partnerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of pendingQuery.data?.items ?? []) for (const o of r.options) seen.set(o.supplierId, o.supplierName);
    for (const r of sentQuery.data?.items ?? []) seen.set(r.supplierId, r.supplierName);
    for (const r of doneQuery.data?.items ?? []) seen.set(r.supplierId, r.supplierName);
    return [{ value: '', label: 'Tất cả đối tác' }, ...[...seen.entries()].map(([value, label]) => ({ value, label }))];
  }, [pendingQuery.data, sentQuery.data, doneQuery.data]);
  const serviceOptions = useMemo(() => {
    const names = new Set<string>();
    for (const r of pendingQuery.data?.items ?? []) names.add(r.serviceName);
    for (const r of sentQuery.data?.items ?? []) names.add(r.serviceName);
    for (const r of doneQuery.data?.items ?? []) names.add(r.serviceName);
    return [{ value: '', label: 'Tất cả dịch vụ' }, ...[...names].sort((a, b) => a.localeCompare(b, 'vi')).map((n) => ({ value: n, label: n }))];
  }, [pendingQuery.data, sentQuery.data, doneQuery.data]);

  const toggleIn = (setter: (fn: (prev: Set<string>) => Set<string>) => void, id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectable = canSend;
  const selectableIds = pendingRows.filter((r) => r.options.length > 0).map((r) => r.itemId);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));
  const sentIds = sentRows.map((r) => r.itemId);
  const allSentSelected = sentIds.length > 0 && sentIds.every((id) => selectedSent.has(id));

  if (enabledQuery.isSuccess && !enabledQuery.data.enabled) {
    return (
      <div className="px-6 pb-5 pt-4">
        <EmptyState icon={Flask} title="Chưa bật tính năng đối tác xét nghiệm" description="Phòng khám chưa dùng đối tác xét nghiệm nên không có mẫu nào để gửi." action={<Button onClick={() => navigate('/')}>Về trang chủ</Button>} />
      </div>
    );
  }

  const activeQuery = tab === 'pending' ? pendingQuery : tab === 'sent' ? sentQuery : doneQuery;
  const gridCost = costVisible;
  const sentSelectable = canReceive;
  const grid = tab === 'pending' ? pendingGrid(selectable, gridCost) : tab === 'sent' ? sentGrid(sentSelectable, gridCost) : doneGrid(gridCost);
  const headers =
    tab === 'pending'
      ? [...(selectable ? [''] : []), 'Mã ống', 'Bệnh nhân', 'Dịch vụ', 'Loại mẫu', 'Lấy mẫu lúc', gridCost ? 'Đối tác gợi ý · giá trả' : 'Đối tác gợi ý', 'Chờ']
      : tab === 'sent'
        ? [...(sentSelectable ? [''] : []), 'Mã ống', 'Bệnh nhân', 'Dịch vụ', 'Đối tác', 'Gửi lúc', 'Hạn trả', 'Tình trạng', ...(gridCost ? ['Giá trả'] : []), 'Thao tác']
        : ['Mã ống', 'Bệnh nhân', 'Dịch vụ', 'Đối tác', 'Gửi lúc', 'Nhận kết quả lúc', 'Thời gian trả', ...(gridCost ? ['Giá trả'] : []), 'Duyệt', 'Thao tác'];
  const minWidth = tab === 'pending' ? 1000 : tab === 'sent' ? (gridCost ? 1250 : 1130) : gridCost ? 1330 : 1220;
  const tabCount = (t: Tab): string => (counts ? String(counts[t]) : '');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 pb-5 pt-4">
      <h1 className="sr-only">Gửi mẫu đối tác</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo trạng thái">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={active}
                className={`rounded-full border px-3.5 pb-2 pt-1 text-[13px] font-semibold ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {t.label} {tabCount(t.key)}
                {t.key === 'done' && canApprove && (counts?.awaitingApproval ?? 0) > 0 && (
                  <span className="ml-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{counts?.awaitingApproval} chờ duyệt</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-56">
            <Combobox id="lp-filter-partner" value={supplierId} onChange={setSupplierId} options={partnerOptions} dense floating />
          </div>
          <div className="w-56">
            <Combobox id="lp-filter-service" value={serviceName} onChange={setServiceName} options={serviceOptions} dense floating />
          </div>
          <div className="relative">
            <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              aria-label="Tìm mẫu"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên, mã BN, mã ống…"
              className="w-60 rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-[13px] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
      </div>

      {tab === 'done' && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc kết quả theo trạng thái duyệt">
          {DONE_FILTERS.map((f) => {
            const active = doneFilter === f.key;
            const n = f.key === 'PENDING' ? awaiting : f.key === 'APPROVED' ? doneAll.length - awaiting : doneAll.length;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setDoneFilter(f.key)}
                aria-pressed={active}
                className={`rounded-md border px-3 py-1 text-[13px] font-semibold ${active ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-brand-teal-tint'}`}
              >
                {f.label} {doneQuery.data ? n : ''}
              </button>
            );
          })}
        </div>
      )}

      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-800">
          <span className="flex items-start gap-2">
            <CheckCircle size={16} weight="fill" className="mt-0.5 flex-none" aria-hidden="true" />
            {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="flex-none text-emerald-700 underline">
            Đóng
          </button>
        </div>
      )}
      {activeQuery.isError && <ErrorBanner message="Không tải được danh sách gửi mẫu đối tác." onRetry={() => void activeQuery.refetch()} />}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="scroll-hover min-h-0 flex-1 overflow-auto">
          <div className="flex min-h-full flex-col" style={{ minWidth }}>
            <div role="row" className="sticky top-0 z-10 grid flex-shrink-0 gap-x-2 border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-semibold uppercase tracking-wide text-slate-800" style={{ gridTemplateColumns: grid }}>
              {headers.map((h, i) => (
                <div key={`${h}-${i}`} role="columnheader" className="px-2 py-3">
                  {tab === 'pending' && selectable && i === 0 ? (
                    <SelectionCheckbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(selectableIds))} ariaLabel="Chọn tất cả mẫu chờ gửi" />
                  ) : tab === 'sent' && sentSelectable && i === 0 ? (
                    <SelectionCheckbox checked={allSentSelected} onChange={() => setSelectedSent(allSentSelected ? new Set() : new Set(sentIds))} ariaLabel="Chọn tất cả mẫu đã gửi" />
                  ) : (
                    h
                  )}
                </div>
              ))}
            </div>

            <div role="table" aria-label="Gửi mẫu đối tác">
              {activeQuery.isLoading && (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              )}

              {tab === 'pending' && !pendingQuery.isLoading && pendingRows.length === 0 && !pendingQuery.isError && (
                <div className="p-6">
                  <EmptyState icon={Flask} title="Không có mẫu nào chờ gửi" description="Mẫu của dịch vụ “Gửi đối tác” sẽ tự xuất hiện ở đây sau khi kỹ thuật viên lấy mẫu." />
                </div>
              )}
              {tab === 'pending' &&
                pendingRows.map((row) => (
                  <PendingRow key={row.itemId} row={row} grid={grid} selectable={selectable} costVisible={gridCost} checked={selected.has(row.itemId)} onToggle={() => toggleIn(setSelected, row.itemId)} />
                ))}

              {tab === 'sent' && !sentQuery.isLoading && sentRows.length === 0 && !sentQuery.isError && (
                <div className="p-6">
                  <EmptyState icon={Flask} title="Chưa có mẫu nào đang chờ kết quả" description="Mẫu đã gửi cho đối tác sẽ hiện ở đây cho tới khi nhận được kết quả." />
                </div>
              )}
              {tab === 'sent' &&
                sentRows.map((row) => (
                  <div key={row.itemId} role="row" className="grid items-center gap-x-2 border-b border-slate-100 text-center text-sm" style={{ gridTemplateColumns: grid, minHeight: ROW_MIN_HEIGHT }}>
                    {sentSelectable && (
                      <div className="px-2">
                        <SelectionCheckbox checked={selectedSent.has(row.itemId)} onChange={() => toggleIn(setSelectedSent, row.itemId)} ariaLabel={`Chọn mẫu ${row.tubeSid ?? row.orderNo}`} />
                      </div>
                    )}
                    <div className="px-2 font-semibold tabular-nums text-slate-800">
                      {row.tubeSid ?? row.orderNo}
                      <div className="text-[11.5px] font-normal text-slate-500">{row.dispatchNo}</div>
                    </div>
                    <PatientCell name={row.patientName} code={row.patientCode} />
                    <div className="min-w-0 px-2 text-left font-medium text-slate-900" title={row.serviceName}>
                      <span className="line-clamp-2">{row.serviceName}</span>
                    </div>
                    <div className="min-w-0 px-2 text-left text-slate-800" title={row.supplierName}>
                      <span className="line-clamp-2">{row.supplierName}</span>
                    </div>
                    <div className="px-2 tabular-nums text-slate-800">
                      {formatShortDateTimeVn(row.sentAt)}
                      <div className="truncate text-[11.5px] text-slate-500" title={row.sentByName ?? undefined}>
                        {row.sentByName ?? ''}
                      </div>
                    </div>
                    <div className={`px-2 tabular-nums ${row.overdue ? 'font-semibold text-rose-600' : 'text-slate-800'}`}>{row.dueAt ? formatShortDateTimeVn(row.dueAt) : '—'}</div>
                    <div className="px-2">{row.overdue ? <StatusBadge tone="danger">Quá hạn</StatusBadge> : <StatusBadge tone="warning">Chờ kết quả</StatusBadge>}</div>
                    {gridCost && <div className="px-2 text-right font-semibold tabular-nums text-slate-900">{row.unitCost !== null ? formatVnd(row.unitCost) : '—'}</div>}
                    <div className="flex items-center justify-center gap-1.5 px-2">
                      {canReceive && (
                        <>
                          <Button type="button" className="whitespace-nowrap px-3" onClick={() => setReceiveRows({ rows: sentRows, ids: new Set([row.itemId]) })}>
                            Nhận kết quả
                          </Button>
                          <RowActionMenu
                            label={`Thao tác khác của mẫu ${row.tubeSid ?? row.orderNo}`}
                            items={[{ key: 'reject', label: 'Đối tác không nhận mẫu', description: 'Mẫu về “Chờ gửi”, lần gửi này không tính tiền', icon: <Prohibit size={15} weight="bold" aria-hidden="true" />, danger: true, onClick: () => setRejectRow(row) }]}
                          />
                        </>
                      )}
                    </div>
                  </div>
                ))}

              {tab === 'done' && !doneQuery.isLoading && doneRows.length === 0 && !doneQuery.isError && (
                <div className="p-6">
                  <EmptyState
                    icon={Flask}
                    title={doneFilter === 'PENDING' ? 'Không có kết quả nào chờ duyệt' : 'Chưa có kết quả nào từ đối tác'}
                    description={doneFilter === 'PENDING' ? 'Kết quả đối tác gửi về sẽ hiện ở đây để bác sĩ xem và duyệt.' : 'Kết quả đã nhận từ đối tác sẽ hiện ở đây.'}
                  />
                </div>
              )}
              {tab === 'done' &&
                doneRows.map((row) => (
                  <div key={row.itemId} role="row" className="grid items-center gap-x-2 border-b border-slate-100 text-center text-sm" style={{ gridTemplateColumns: grid, minHeight: ROW_MIN_HEIGHT }}>
                    <div className="px-2 font-semibold tabular-nums text-slate-800">
                      {row.tubeSid ?? row.orderNo}
                      <div className="text-[11.5px] font-normal text-slate-500">{row.dispatchNo}</div>
                    </div>
                    <PatientCell name={row.patientName} code={row.patientCode} />
                    <div className="min-w-0 px-2 text-left font-medium text-slate-900" title={row.serviceName}>
                      <span className="line-clamp-2">{row.serviceName}</span>
                    </div>
                    <div className="min-w-0 px-2 text-left text-slate-800" title={row.supplierName}>
                      <span className="line-clamp-2">{row.supplierName}</span>
                    </div>
                    <div className="px-2 tabular-nums text-slate-800">{formatShortDateTimeVn(row.sentAt)}</div>
                    <div className="px-2 tabular-nums text-slate-800">
                      {formatShortDateTimeVn(row.receivedAt)}
                      <div className="truncate text-[11.5px] text-slate-500" title={row.receivedByName ?? undefined}>
                        {row.receivedByName ?? ''}
                      </div>
                    </div>
                    <div className={`px-2 ${row.late ? 'font-semibold text-rose-600' : 'text-slate-800'}`}>
                      {formatWaitDuration(row.sentAt, new Date(row.receivedAt).getTime())}
                      {row.late && <div className="text-[11.5px]">Quá hạn</div>}
                    </div>
                    {gridCost && <div className="px-2 text-right font-semibold tabular-nums text-slate-900">{row.unitCost !== null ? formatVnd(row.unitCost) : '—'}</div>}
                    <div className="px-2">{row.approval === 'APPROVED' ? <StatusBadge tone="success">Đã duyệt</StatusBadge> : <StatusBadge tone="warning">Chờ duyệt</StatusBadge>}</div>
                    <div className="flex items-center justify-center px-2">
                      <Button type="button" variant={row.approval === 'PENDING' && canApprove ? 'primary' : 'secondary'} className="whitespace-nowrap px-3" onClick={() => setResultItemId(row.itemId)}>
                        {row.approval === 'PENDING' && canApprove ? 'Xem và duyệt' : 'Xem PDF'}
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {tab === 'pending' && canSend && (
          <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5">
            <span className="text-sm text-slate-600">{selected.size > 0 ? `Đã chọn ${selected.size} mẫu.` : 'Tích các mẫu cần gửi rồi bấm “Gửi mẫu đi”.'}</span>
            <Button type="button" disabled={selected.size === 0} onClick={() => setSendRows(pendingRows.filter((r) => selected.has(r.itemId)))}>
              <PaperPlaneTiltIcon size={16} weight="bold" aria-hidden="true" />
              Gửi mẫu đi ({selected.size})
            </Button>
          </div>
        )}
        {tab === 'sent' && canReceive && (
          <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5">
            <span className="text-sm text-slate-600">{selectedSent.size > 0 ? `Đã chọn ${selectedSent.size} mẫu.` : 'Tích các mẫu cùng đối tác để nhận chung một tệp kết quả.'}</span>
            <Button type="button" disabled={selectedSent.size === 0} onClick={() => setReceiveRows({ rows: sentRows, ids: new Set(selectedSent) })}>
              <DownloadSimple size={16} weight="bold" aria-hidden="true" />
              Nhận kết quả ({selectedSent.size})
            </Button>
          </div>
        )}
        {tab === 'done' && (
          <div className="flex-shrink-0 border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-500">{doneRows.length > 0 ? `${doneRows.length} kết quả` : ''}</div>
        )}
      </div>

      {sendRows && (
        <LabPartnerSendDialog
          rows={sendRows}
          initialSelectedIds={new Set(sendRows.map((r) => r.itemId))}
          costVisible={gridCost}
          onClose={() => setSendRows(null)}
          onDone={(result: SendLabPartnerSamplesResponse) => {
            setSendRows(null);
            setSelected(new Set());
            setNotice(`Đã gửi ${result.items.length} mẫu cho ${result.supplierName} (đợt ${result.dispatchNo}).`);
          }}
        />
      )}
      {receiveRows && (
        <LabPartnerReceiveDialog
          rows={receiveRows.rows}
          initialSelectedIds={receiveRows.ids}
          costVisible={gridCost}
          onClose={() => setReceiveRows(null)}
          onDone={(result: ReceiveLabPartnerResultResponse) => {
            setReceiveRows(null);
            setSelectedSent(new Set());
            setNotice(`Đã nhận kết quả ${result.receivedCount} mẫu từ ${result.supplierName}. Kết quả chờ bác sĩ duyệt.`);
          }}
          onRejected={(count) => {
            setReceiveRows(null);
            setSelectedSent(new Set());
            setNotice(`Đã trả ${count} mẫu về “Chờ gửi”.`);
          }}
        />
      )}
      {rejectRow && (
        <ReasonConfirmDialog
          title="Đối tác không nhận mẫu"
          rows={[
            { label: 'Mẫu', value: rejectRow.tubeSid ?? rejectRow.orderNo, sub: `${rejectRow.patientName} · ${rejectRow.serviceName}` },
            { label: 'Đối tác', value: rejectRow.supplierName },
          ]}
          note="Mẫu về “Chờ gửi” để chọn đối tác khác. Lần gửi này không tính tiền."
          confirmLabel="Trả về chờ gửi"
          confirmVariant="danger"
          onConfirm={(reason) => rejectMutation.mutateAsync({ itemId: rejectRow.itemId, body: { reason } })}
          onDone={() => {
            setRejectRow(null);
            setNotice('Đã trả mẫu về “Chờ gửi”.');
          }}
          onClose={() => setRejectRow(null)}
        />
      )}
      {openResult && (
        <LabPartnerResultDialog
          row={openResult}
          hasNext={nextPending !== undefined}
          canApprove={canApprove}
          canReturn={canReceive}
          onClose={() => setResultItemId(null)}
          onApproved={(openNext) => {
            setNotice(`Đã duyệt kết quả của ${openResult.patientName}.`);
            setResultItemId(openNext && nextPending ? nextPending.itemId : null);
          }}
          onReturned={() => {
            setResultItemId(null);
            setNotice('Đã trả kết quả lại kỹ thuật viên, mẫu về “Đã gửi chờ kết quả”.');
          }}
        />
      )}
    </div>
  );
}

function PatientCell({ name, code }: { name: string; code: string }) {
  return (
    <div className="min-w-0 px-2 py-1.5 text-left">
      <div className="truncate font-semibold text-slate-900" title={name}>
        {name}
      </div>
      <div className="text-[11.5px] text-slate-500">{code}</div>
    </div>
  );
}

function PendingRow({ row, grid, selectable, costVisible, checked, onToggle }: { row: LabPartnerPendingRow; grid: string; selectable: boolean; costVisible: boolean; checked: boolean; onToggle: () => void }) {
  const suggested = defaultOptionOf(row);
  const long = row.collectedAt ? isLongWait(row.collectedAt) : false;
  return (
    <div role="row" className="grid items-center gap-x-2 border-b border-slate-100 text-center text-sm" style={{ gridTemplateColumns: grid, minHeight: ROW_MIN_HEIGHT }}>
      {selectable && (
        <div className="px-2">
          {row.options.length > 0 ? <SelectionCheckbox checked={checked} onChange={onToggle} ariaLabel={`Chọn mẫu ${row.tubeSid ?? row.orderNo}`} /> : <span aria-hidden="true" />}
        </div>
      )}
      <div className="px-2 font-semibold tabular-nums text-slate-800">
        {row.tubeSid ?? '—'}
        <div className="text-[11.5px] font-normal text-slate-500">{row.orderNo}</div>
      </div>
      <PatientCell name={row.patientName} code={row.patientCode} />
      <div className="min-w-0 px-2 text-left font-medium text-slate-900" title={row.serviceName}>
        <span className="line-clamp-2">{row.serviceName}</span>
      </div>
      <div className="min-w-0 px-2 text-slate-700">{row.specimenName ?? '—'}</div>
      <div className="px-2 tabular-nums text-slate-800">
        {row.collectedAt ? formatShortDateTimeVn(row.collectedAt) : '—'}
        <div className="truncate text-[11.5px] text-slate-500" title={row.collectedByName ?? undefined}>
          {row.collectedByName ?? ''}
        </div>
      </div>
      <div className="min-w-0 px-2 text-left">
        {suggested ? (
          <>
            <div className="truncate font-medium text-slate-900" title={suggested.supplierName}>
              {suggested.supplierName}
            </div>
            <div className="text-[11.5px] text-slate-500">
              {row.options.length > 1 ? `${row.options.length} đối tác có giá` : 'Một đối tác'}
              {costVisible && suggested.amount !== null ? ` · ${formatVnd(suggested.amount)}` : ''}
            </div>
          </>
        ) : (
          <span className="flex items-center gap-1 text-[12.5px] font-semibold text-amber-700">
            <Warning size={14} weight="fill" aria-hidden="true" />
            Chưa cấu hình đối tác
          </span>
        )}
      </div>
      <div className="px-2 font-semibold">{row.collectedAt ? long ? <StatusBadge tone="danger">{formatWaitDuration(row.collectedAt)}</StatusBadge> : <span className="text-slate-600">{formatWaitDuration(row.collectedAt)}</span> : '—'}</div>
    </div>
  );
}
