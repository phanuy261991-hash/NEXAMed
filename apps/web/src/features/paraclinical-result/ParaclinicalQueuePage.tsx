import { useMemo, useState } from 'react';
import { Flask, MagnifyingGlass, Scan } from '@phosphor-icons/react';
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
import { formatWaitDuration, genderShort, isLongWait, QUEUE_BUCKET_ORDER, SERVICE_KIND_LABELS } from './paraclinical-result-labels';
import { PARACLINICAL_GROUP_META, type ParaclinicalGroup } from './paraclinical-group';
import { useParaclinicalQueueQuery, useStartParaclinicalMutation } from './paraclinical-result.queries';

const ROW_HEIGHT_PX = 60;

/** Cột bảng theo nhóm menu (mockup 12a/12b): xét nghiệm có "Mẫu bệnh phẩm"; CĐHA & thăm dò có "Loại" + "Phòng thực hiện". */
const COLUMNS: Record<ParaclinicalGroup, { grid: string; minWidth: number; headers: string[] }> = {
  lab: {
    grid: '120px minmax(180px,210px) minmax(200px,1fr) 160px 96px 100px 150px',
    minWidth: 1000,
    headers: ['Mã phiếu', 'Bệnh nhân', 'Xét nghiệm chỉ định', 'Mẫu bệnh phẩm', 'Chờ', 'Thanh toán', 'Thao tác'],
  },
  imaging: {
    grid: '120px minmax(180px,210px) minmax(150px,1fr) 108px 128px 92px 100px 150px',
    minWidth: 1060,
    headers: ['Mã phiếu', 'Bệnh nhân', 'Dịch vụ chỉ định', 'Loại', 'Phòng thực hiện', 'Chờ', 'Thanh toán', 'Thao tác'],
  },
};

/** Hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD (định dạng `sv-SE` chính là ISO). */
function todayVn(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

const distinct = (values: string[]): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'vi'));

/**
 * Hàng đợi cận lâm sàng — 2 menu riêng (`/paraclinical/lab`, `/paraclinical/imaging`; Cận lâm sàng GĐ4, docs/DECISIONS.md #212, tách menu #215; mockup 12a/12b). Cùng một trang, khác
 * nhóm dịch vụ + quyền + vài cột/bộ lọc: Xét nghiệm có bước LẤY MẪU và lọc theo nhóm xét nghiệm / mẫu bệnh phẩm; CĐHA & Thăm dò chức năng có bước GỌI VÀO PHÒNG và lọc theo loại / phòng.
 * 5 tab: Chờ thu tiền → Chờ lấy mẫu (gọi vào phòng) → Đang thực hiện → Chờ duyệt kết quả → Đã trả kết quả. Xét nghiệm cùng phiếu + cùng trạng thái gộp 1 dòng (một lần lấy mẫu,
 * một màn nhập kết quả); chẩn đoán hình ảnh / thăm dò chức năng mỗi dịch vụ 1 dòng. Tự làm mới mỗi 30 giây. Các bộ lọc lọc ngay trên dữ liệu đã tải (số trên tab không đổi theo bộ lọc).
 */
export function ParaclinicalQueuePage({ group }: { group: ParaclinicalGroup }) {
  const meta = PARACLINICAL_GROUP_META[group];
  const columns = COLUMNS[group];
  useBreadcrumb([{ label: 'Cận lâm sàng' }, { label: meta.label }]);
  const navigate = useNavigate();
  const canEnter = useHasPermission(meta.permissionModule, 'enter');
  const canApprove = useHasPermission(meta.permissionModule, 'approve');
  const [bucket, setBucket] = useState<ParaclinicalQueueBucket>('WAITING');
  const [date, setDate] = useState(todayVn);
  const [filterA, setFilterA] = useState(''); // xét nghiệm: nhóm xét nghiệm · CĐHA: loại dịch vụ
  const [filterB, setFilterB] = useState(''); // xét nghiệm: mẫu bệnh phẩm · CĐHA: phòng thực hiện
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const [actionError, setActionError] = useState<string | null>(null);

  const params: ListParaclinicalQueueQuery = useMemo(() => ({ date, ...(debouncedSearch ? { q: debouncedSearch } : {}) }), [date, debouncedSearch]);
  const query = useParaclinicalQueueQuery(group, params);
  const startMutation = useStartParaclinicalMutation(group);

  const allRows = useMemo(() => query.data?.items ?? [], [query.data]);
  const counts = query.data?.counts;

  const rows = allRows.filter((r) => {
    if (r.bucket !== bucket) return false;
    if (group === 'lab') return (filterA === '' || r.categoryNames.includes(filterA)) && (filterB === '' || r.specimenNames.includes(filterB));
    return (filterA === '' || r.serviceKind === filterA) && (filterB === '' || r.departmentId === filterB);
  });

  // Tuỳ chọn bộ lọc lấy từ chính dữ liệu đang có trong hàng đợi (không gọi thêm API danh mục — kỹ thuật viên không nhất thiết có quyền đọc danh mục).
  const filterOptions = useMemo(() => {
    if (group === 'lab') {
      return {
        a: [{ value: '', label: 'Tất cả nhóm xét nghiệm' }, ...distinct(allRows.flatMap((r) => r.categoryNames)).map((n) => ({ value: n, label: n }))],
        b: [{ value: '', label: 'Tất cả mẫu bệnh phẩm' }, ...distinct(allRows.flatMap((r) => r.specimenNames)).map((n) => ({ value: n, label: n }))],
      };
    }
    const rooms = new Map<string, string>();
    for (const r of allRows) if (r.departmentId && r.departmentName) rooms.set(r.departmentId, r.departmentName);
    return {
      a: [
        { value: '', label: 'Tất cả loại dịch vụ' },
        { value: 'IMAGING', label: SERVICE_KIND_LABELS.IMAGING },
        { value: 'FUNCTIONAL', label: SERVICE_KIND_LABELS.FUNCTIONAL },
      ],
      b: [{ value: '', label: 'Tất cả phòng thực hiện' }, ...[...rooms.entries()].map(([value, label]) => ({ value, label }))],
    };
  }, [group, allRows]);

  async function handleStart(row: ParaclinicalQueueRow) {
    setActionError(null);
    try {
      const res = await startMutation.mutateAsync({ itemIds: row.itemIds });
      navigate(`${meta.basePath}/items/${res.itemId}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Không thực hiện được. Thử lại sau.');
    }
  }

  function actionOf(row: ParaclinicalQueueRow): { label: string; run: () => void; loading?: boolean } | null {
    const open = () => navigate(`${meta.basePath}/items/${row.key}`);
    switch (row.bucket) {
      case 'WAITING':
        return canEnter ? { label: meta.startLabel, run: () => void handleStart(row), loading: startMutation.isPending } : null;
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

  const EmptyIcon = group === 'lab' ? Flask : Scan;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 pb-5 pt-4">
      <h1 className="sr-only">{meta.queueTitle}</h1>

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
                // pt-1/pb-2 (không phải py-1.5): chữ Segoe UI có khoảng trống dưới đường cơ sở lớn hơn trên nên nhìn bị lệch xuống; dồn thêm đệm xuống đáy để chữ nằm giữa pill.
                className={`rounded-full border px-3.5 pb-2 pt-1 text-[13px] font-semibold ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {meta.bucketLabels[key]} {counts?.[key] ?? ''}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-52">
            <Combobox id="pq-filter-a" value={filterA} onChange={setFilterA} options={filterOptions.a} dense floating />
          </div>
          <div className="w-52">
            <Combobox id="pq-filter-b" value={filterB} onChange={setFilterB} options={filterOptions.b} dense floating />
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

      {query.isError && <ErrorBanner message={`Không tải được ${meta.queueTitle.toLowerCase()}.`} onRetry={() => query.refetch()} />}
      {actionError && <ErrorBanner message={actionError} />}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="scroll-hover min-h-0 flex-1 overflow-auto">
          <div className="flex min-h-full flex-col" style={{ minWidth: columns.minWidth }}>
            <div
              role="row"
              className="sticky top-0 z-10 grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 text-center text-xs font-bold uppercase tracking-wide text-slate-800"
              style={{ gridTemplateColumns: columns.grid }}
            >
              {columns.headers.map((h) => (
                <div key={h} role="columnheader" className="px-2 py-3">
                  {h}
                </div>
              ))}
            </div>

            <div role="table" aria-label={meta.queueTitle}>
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
                    icon={EmptyIcon}
                    title="Không có phiếu nào ở trạng thái này"
                    description={bucket === 'COMPLETED' ? 'Chưa có kết quả nào được trả trong ngày đang xem.' : 'Phiếu mới sẽ tự xuất hiện khi bác sĩ chỉ định và thu ngân thu tiền.'}
                  />
                </div>
              )}
              {rows.map((row) => {
                const action = actionOf(row);
                const long = (row.bucket === 'WAITING' || row.bucket === 'IN_PROGRESS') && isLongWait(row.waitingSince);
                return (
                  <div key={row.key} role="row" className="grid items-center border-b border-slate-100 text-center text-sm" style={{ gridTemplateColumns: columns.grid, minHeight: ROW_HEIGHT_PX }}>
                    <div className="px-2 font-semibold text-slate-800">
                      {row.orderNo}
                      {row.isAmendment && (
                        <div className="mt-0.5">
                          <StatusBadge tone="accent">Đính chính</StatusBadge>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 px-2.5 py-1.5 text-left">
                      <div className="truncate font-bold text-slate-900" title={row.patientName}>
                        {row.patientName}
                      </div>
                      <div className="text-[11.5px] text-slate-500">
                        {row.patientCode} · {row.ageYears ?? '—'} · {genderShort(row.gender)}
                      </div>
                    </div>
                    <div className="min-w-0 px-2.5 text-left font-medium text-slate-900" title={row.serviceNames.join(', ')}>
                      <span className="line-clamp-2">{row.serviceNames.join(', ')}</span>
                    </div>
                    {group === 'lab' ? (
                      <div className="px-2 font-medium text-slate-600">{row.specimenNames.length > 0 ? row.specimenNames.join(', ') : '—'}</div>
                    ) : (
                      <>
                        <div className="px-2">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{row.serviceKind === 'FUNCTIONAL' ? 'Thăm dò CN' : 'CĐHA'}</span>
                        </div>
                        <div className="px-2 font-medium text-slate-600">{row.departmentName ?? '—'}</div>
                      </>
                    )}
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
          {rows.length > 0 ? `${rows.length} phiếu ở "${meta.bucketLabels[bucket]}"` : ''}
          {query.data && !query.data.allowBeforePayment && bucket === 'WAITING' ? ` · Chỉ phiếu đã thu tiền mới ${group === 'lab' ? 'lấy mẫu' : 'gọi vào phòng'} được` : ''}
        </div>
      </div>
    </div>
  );
}
