import { useMemo, useState } from 'react';
import { Flask, MagnifyingGlass } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import type { ListParaclinicalQueueQuery, ParaclinicalQueueBucket, ParaclinicalQueueRow } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatClockTime } from '../../shared/format/time';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useHasPermission } from '../auth/usePermission';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { formatWaitDuration, genderShort, isLongWait, QUEUE_BUCKET_LABELS, QUEUE_BUCKET_ORDER, waitingActionLabel } from './paraclinical-result-labels';
import { useParaclinicalQueueQuery, useStartParaclinicalMutation } from './paraclinical-result.queries';

const GRID_COLUMNS = '128px minmax(170px,190px) 84px minmax(180px,1fr) 140px 104px 108px 150px';
const TABLE_MIN_WIDTH_PX = 1100;
const ROW_HEIGHT_PX = 60;

/** Hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD (định dạng `sv-SE` chính là ISO). */
function todayVn(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/**
 * "Hàng đợi cận lâm sàng" (`/paraclinical/queue`, Cận lâm sàng GĐ4 đợt 1, docs/DECISIONS.md #212, mockup màn HangDoi) — kỹ thuật viên/điều dưỡng xem việc theo 5 tab:
 * Chờ thu tiền → Chờ lấy mẫu / gọi vào phòng → Đang thực hiện → Chờ duyệt kết quả → Đã trả kết quả. Xét nghiệm cùng phiếu + cùng trạng thái gộp 1 dòng (một lần lấy mẫu,
 * một màn nhập kết quả); chẩn đoán hình ảnh / thăm dò chức năng mỗi dịch vụ 1 dòng. Tự làm mới mỗi 30 giây.
 */
export function ParaclinicalQueuePage() {
  useBreadcrumb([{ label: 'Cận lâm sàng' }, { label: 'Hàng đợi cận lâm sàng' }]);
  const navigate = useNavigate();
  const canEnter = useHasPermission('paraclinical_result', 'enter');
  const canApprove = useHasPermission('paraclinical_result', 'approve');
  const [bucket, setBucket] = useState<ParaclinicalQueueBucket>('WAITING');
  const [date, setDate] = useState(todayVn);
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const [actionError, setActionError] = useState<string | null>(null);

  const params: ListParaclinicalQueueQuery = useMemo(
    () => ({ date, ...(departmentId ? { departmentId } : {}), ...(debouncedSearch ? { q: debouncedSearch } : {}) }),
    [date, departmentId, debouncedSearch],
  );
  const query = useParaclinicalQueueQuery(params);
  const startMutation = useStartParaclinicalMutation();
  const departmentsQuery = useDepartmentOptionsQuery(false);

  const rows = (query.data?.items ?? []).filter((r) => r.bucket === bucket);
  const counts = query.data?.counts;
  const departmentOptions = [{ value: '', label: 'Tất cả phòng thực hiện' }, ...(departmentsQuery.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))];

  async function handleStart(row: ParaclinicalQueueRow) {
    setActionError(null);
    try {
      const res = await startMutation.mutateAsync({ itemIds: row.itemIds });
      navigate(`/paraclinical/items/${res.itemId}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Không thực hiện được. Thử lại sau.');
    }
  }

  function actionOf(row: ParaclinicalQueueRow): { label: string; run: () => void; loading?: boolean } | null {
    const open = () => navigate(`/paraclinical/items/${row.key}`);
    switch (row.bucket) {
      case 'WAITING':
        return canEnter ? { label: waitingActionLabel(row.serviceKind), run: () => void handleStart(row), loading: startMutation.isPending } : null;
      case 'IN_PROGRESS':
        return { label: canEnter ? 'Nhập kết quả' : 'Xem', run: open };
      case 'PENDING_APPROVAL':
        return { label: canApprove ? 'Duyệt kết quả' : 'Xem', run: open };
      case 'COMPLETED':
        return { label: 'Xem kết quả', run: open };
      default:
        return null;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 pb-5 pt-4">
      <h1 className="sr-only">Hàng đợi cận lâm sàng</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo trạng thái">
          {QUEUE_BUCKET_ORDER.map((key) => {
            const active = bucket === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setBucket(key)}
                aria-pressed={active}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {QUEUE_BUCKET_LABELS[key]} {counts?.[key] ?? ''}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-52">
            <Combobox id="pq-department" value={departmentId} onChange={setDepartmentId} options={departmentOptions} dense floating />
          </div>
          <div className="w-40">
            <DateInput id="pq-date" value={date} onChange={(v) => v && setDate(v)} dense />
          </div>
          <div className="relative">
            <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              aria-label="Tìm bệnh nhân"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên, mã BN, mã phiếu…"
              className="w-60 rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-[13px] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
      </div>

      {query.isError && <ErrorBanner message="Không tải được hàng đợi cận lâm sàng." onRetry={() => query.refetch()} />}
      {actionError && <ErrorBanner message={actionError} />}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="scroll-hover min-h-0 flex-1 overflow-auto">
          <div className="flex min-h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
            <div
              role="row"
              className="sticky top-0 z-10 grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-bold uppercase tracking-wide text-slate-800"
              style={{ gridTemplateColumns: GRID_COLUMNS }}
            >
              {['Mã phiếu', 'Bệnh nhân', 'Tuổi / GT', 'Dịch vụ chỉ định', 'Phòng thực hiện', 'Chờ', 'Thanh toán', 'Thao tác'].map((h) => (
                <div key={h} role="columnheader" className="px-2 py-3">
                  {h}
                </div>
              ))}
            </div>

            <div role="table" aria-label="Hàng đợi cận lâm sàng">
              {query.isLoading && (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              )}
              {!query.isLoading && rows.length === 0 && !query.isError && (
                <div className="p-6">
                  <EmptyState
                    icon={Flask}
                    title="Không có phiếu nào ở trạng thái này"
                    description={bucket === 'COMPLETED' ? 'Chưa có kết quả nào được trả trong ngày đang xem.' : 'Phiếu mới sẽ tự xuất hiện khi bác sĩ chỉ định và thu ngân thu tiền.'}
                  />
                </div>
              )}
              {rows.map((row) => {
                const action = actionOf(row);
                const long = (row.bucket === 'WAITING' || row.bucket === 'IN_PROGRESS') && isLongWait(row.waitingSince);
                return (
                  <div key={row.key} role="row" className="grid items-center border-b border-slate-100 text-center text-sm" style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}>
                    <div className="px-2 font-semibold text-slate-800">{row.orderNo}</div>
                    <div className="min-w-0 px-2.5 py-1.5 text-left">
                      <div className="truncate font-bold text-slate-900" title={row.patientName}>
                        {row.patientName}
                      </div>
                      <div className="text-[11.5px] text-slate-500">{row.patientCode}</div>
                    </div>
                    <div className="px-1 font-medium text-slate-600">
                      {row.ageYears ?? '—'} · {genderShort(row.gender)}
                    </div>
                    <div className="min-w-0 px-2.5 text-left font-medium text-slate-900" title={row.serviceNames.join(', ')}>
                      <span className="line-clamp-2">{row.serviceNames.join(', ')}</span>
                    </div>
                    <div className="px-2 font-medium text-slate-600">{row.departmentName ?? '—'}</div>
                    <div className="px-2 font-semibold">
                      {row.bucket === 'COMPLETED' ? (
                        <span className="text-slate-600">{formatClockTime(row.waitingSince)}</span>
                      ) : long ? (
                        <StatusBadge tone="danger">{formatWaitDuration(row.waitingSince)}</StatusBadge>
                      ) : (
                        <span className="text-slate-600">{formatWaitDuration(row.waitingSince)}</span>
                      )}
                    </div>
                    <div className="px-2">{row.paid ? <StatusBadge tone="success">Đã thu</StatusBadge> : <StatusBadge tone="warning">{row.bucket === 'AWAITING_PAYMENT' ? 'Chưa thu' : 'Nợ phí'}</StatusBadge>}</div>
                    <div className="flex justify-center px-2">
                      {action ? (
                        <Button type="button" onClick={action.run} loading={action.loading}>
                          {action.label}
                        </Button>
                      ) : (
                        <span className="text-xs font-medium text-slate-400">Chờ thu tiền</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-500">
          {rows.length > 0 ? `${rows.length} phiếu ở "${QUEUE_BUCKET_LABELS[bucket]}"` : ''}
          {query.data && !query.data.allowBeforePayment && bucket === 'WAITING' ? ' · Chỉ phiếu đã thu tiền mới lấy mẫu / gọi vào phòng được' : ''}
        </div>
      </div>
    </div>
  );
}
