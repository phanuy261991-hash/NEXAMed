import { useMemo, useState } from 'react';
import { ArrowCounterClockwise, Barcode, Eye, Flask, MagnifyingGlass, Printer, Scan, Warning } from '@phosphor-icons/react';
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
import { RowActionMenu } from '../../shared/ui/RowActionMenu';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useActorDepartmentId, useDataScope, useHasPermission } from '../auth/usePermission';
import { formatWaitDuration, genderShort, isLongWait, QUEUE_BUCKET_ORDER, SERVICE_KIND_LABELS } from './paraclinical-result-labels';
import { PARACLINICAL_GROUP_META, type ParaclinicalGroup } from './paraclinical-group';
import { ParaclinicalOrderQuickViewDialog } from './ParaclinicalOrderQuickViewDialog';
import { useParaclinicalQueueQuery, useStartParaclinicalMutation } from './paraclinical-result.queries';
import { CapColorDot } from '../../shared/ui/SpecimenCapColor';
import { normalizeScan } from './specimen-scan';
import { useSpecimenCollection } from './specimen-tube.queries';
import { SpecimenCollectionDialog } from './SpecimenCollectionDialog';
import { SpecimenUncollectDialog } from './SpecimenUncollectDialog';

const ROW_HEIGHT_PX = 60;

/**
 * Cột bảng theo nhóm menu và tab (mockup 12a/12b, 13a/13d). Xét nghiệm: tab "Chờ lấy mẫu" có cột "Ống cần lấy", tab "Đã lấy mẫu" có "Ống mẫu (SID)" + "Lấy mẫu" + "Kết quả"
 * (docs/DECISIONS.md #220); các tab còn lại giữ cột "Mẫu bệnh phẩm". CĐHA & thăm dò có "Loại" + "Phòng thực hiện".
 */
type ColumnKind = 'lab-waiting' | 'lab-collected' | 'lab-default' | 'imaging';
const COLUMN_SETS: Record<ColumnKind, { grid: string; minWidth: number; headers: string[] }> = {
  'lab-waiting': {
    grid: '120px minmax(180px,210px) minmax(200px,1fr) 270px 96px 100px 188px',
    minWidth: 1148,
    headers: ['Mã phiếu', 'Bệnh nhân', 'Xét nghiệm chỉ định', 'Ống cần lấy', 'Chờ', 'Thanh toán', 'Thao tác'],
  },
  'lab-collected': {
    grid: '120px minmax(170px,200px) minmax(180px,1fr) 170px 120px 104px 236px',
    minWidth: 1100,
    headers: ['Mã phiếu', 'Bệnh nhân', 'Xét nghiệm', 'Ống mẫu (SID)', 'Lấy mẫu', 'Kết quả', 'Thao tác'],
  },
  'lab-default': {
    grid: '120px minmax(180px,210px) minmax(200px,1fr) 160px 96px 100px 188px',
    minWidth: 1038,
    headers: ['Mã phiếu', 'Bệnh nhân', 'Xét nghiệm chỉ định', 'Mẫu bệnh phẩm', 'Chờ', 'Thanh toán', 'Thao tác'],
  },
  imaging: {
    grid: '120px minmax(180px,210px) minmax(150px,1fr) 108px 128px 92px 100px 188px',
    minWidth: 1098,
    headers: ['Mã phiếu', 'Bệnh nhân', 'Dịch vụ chỉ định', 'Loại', 'Phòng thực hiện', 'Chờ', 'Thanh toán', 'Thao tác'],
  },
};

function columnKindOf(group: ParaclinicalGroup, bucket: ParaclinicalQueueBucket): ColumnKind {
  if (group === 'imaging') return 'imaging';
  if (bucket === 'WAITING') return 'lab-waiting';
  if (bucket === 'IN_PROGRESS') return 'lab-collected';
  return 'lab-default';
}

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
  useBreadcrumb([{ label: 'Cận lâm sàng' }, { label: meta.label }]);
  const navigate = useNavigate();
  const canEnter = useHasPermission(meta.permissionModule, 'enter');
  const canApprove = useHasPermission(meta.permissionModule, 'approve');
  // Quyền giới hạn theo Khoa/Phòng mà tài khoản chưa được gán phòng thì không khớp phòng nào → hàng đợi luôn trống; báo rõ thay vì để trống im lặng.
  const scopedToDepartment = useDataScope(meta.permissionModule, 'read') === 'department';
  const actorDepartmentId = useActorDepartmentId();
  const missingDepartment = scopedToDepartment && actorDepartmentId === null;
  const [bucket, setBucket] = useState<ParaclinicalQueueBucket>('WAITING');
  const [date, setDate] = useState(todayVn);
  const [filterA, setFilterA] = useState(''); // xét nghiệm: nhóm xét nghiệm · CĐHA: loại dịch vụ
  const [filterB, setFilterB] = useState(''); // xét nghiệm: mẫu bệnh phẩm · CĐHA: phòng thực hiện
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const [actionError, setActionError] = useState<string | null>(null);
  const [quickViewRow, setQuickViewRow] = useState<ParaclinicalQueueRow | null>(null);
  // Lấy mẫu xét nghiệm có ống mẫu/tem mã vạch (docs/DECISIONS.md #220): hộp thoại lấy mẫu của một phiếu, hộp thoại huỷ xác nhận, ô quét mã ống.
  const [collection, setCollection] = useState<{ orderId: string; initialSid: string | null } | null>(null);
  const [uncollectRow, setUncollectRow] = useState<ParaclinicalQueueRow | null>(null);
  const [scanText, setScanText] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const specimen = useSpecimenCollection();
  const columns = COLUMN_SETS[columnKindOf(group, bucket)];
  const columnKind = columnKindOf(group, bucket);

  const params: ListParaclinicalQueueQuery = useMemo(() => ({ date, ...(debouncedSearch ? { q: debouncedSearch } : {}) }), [date, debouncedSearch]);
  const query = useParaclinicalQueueQuery(group, params);
  const startMutation = useStartParaclinicalMutation();

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

  /** "Gọi vào phòng" — chỉ CĐHA & Thăm dò chức năng. Xét nghiệm mở hộp thoại lấy mẫu (`setCollection`). */
  async function handleStart(row: ParaclinicalQueueRow) {
    setActionError(null);
    try {
      const res = await startMutation.mutateAsync({ itemIds: row.itemIds });
      navigate(`${meta.basePath}/items/${res.itemId}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Không thực hiện được. Thử lại sau.');
    }
  }

  /** Ô "Quét mã ống" (súng quét USB gõ mã + Enter): ống chưa lấy → mở hộp thoại với ống đó đã tích; ống đã lấy → mở thẳng màn nhập kết quả; ống huỷ/lạ → báo lỗi tại chỗ. */
  async function handleScan() {
    const sid = normalizeScan(scanText);
    setScanText('');
    if (sid === '') return;
    setScanError(null);
    setActionError(null);
    try {
      const found = await specimen.lookup.mutateAsync(sid);
      if (found.encounterCancelled) setScanError(`Ống ${sid} thuộc lượt khám đã huỷ — không còn dùng được.`);
      else if (found.status === 'CANCELLED') setScanError(`Ống ${sid} đã huỷ${found.replacedBySid ? ` — dùng ống thay thế ${found.replacedBySid}` : ''}.`);
      else if (found.status === 'PENDING') {
        if (canEnter) setCollection({ orderId: found.orderId, initialSid: sid });
        else setScanError('Tài khoản không có quyền lấy mẫu xét nghiệm.');
      } else if (found.itemId) navigate(`${meta.basePath}/items/${found.itemId}`);
    } catch (err) {
      setScanError(err instanceof ApiError && err.code === 'NOT_FOUND' ? `Không tìm thấy ống mang mã ${sid}.` : err instanceof ApiError ? err.message : 'Không tra được mã ống. Thử lại sau.');
    }
  }

  function actionOf(row: ParaclinicalQueueRow): { label: string; run: () => void; loading?: boolean } | null {
    const open = () => navigate(`${meta.basePath}/items/${row.key}`);
    switch (row.bucket) {
      case 'WAITING':
        if (!canEnter) return null;
        return group === 'lab' ? { label: meta.startLabel, run: () => setCollection({ orderId: row.orderId, initialSid: null }) } : { label: meta.startLabel, run: () => void handleStart(row), loading: startMutation.isPending };
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
          {group === 'lab' && canEnter && (
            <div className="relative">
              <label htmlFor="pq-scan" className="sr-only">
                Quét mã ống
              </label>
              <Barcode size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-600" aria-hidden="true" />
              <input
                id="pq-scan"
                value={scanText}
                onChange={(e) => setScanText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleScan();
                  }
                }}
                autoComplete="off"
                placeholder="Quét mã ống…"
                className="w-52 rounded-md border-2 border-blue-500 py-1.5 pl-8 pr-2.5 text-[13px] font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
              />
            </div>
          )}
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

      {missingDepartment && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          <Warning size={16} weight="fill" className="mt-0.5 flex-none" aria-hidden="true" />
          Tài khoản của bạn chỉ được xem việc của Khoa/Phòng mình nhưng chưa được gán Khoa/Phòng nên hàng đợi sẽ luôn trống. Nhờ quản trị viên gán Khoa/Phòng ở "Quản lý tài khoản".
        </div>
      )}
      {query.isError && <ErrorBanner message={`Không tải được ${meta.queueTitle.toLowerCase()}.`} onRetry={() => query.refetch()} />}
      {actionError && <ErrorBanner message={actionError} />}
      {scanError && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
          <Warning size={16} weight="fill" className="flex-none" aria-hidden="true" />
          {scanError}
        </div>
      )}

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
                    {columnKind === 'lab-waiting' ? (
                      <div className="flex min-w-0 flex-col items-start gap-1 px-3 py-1.5 text-left">
                        {row.tubes.length === 0 && <span className="text-slate-400">—</span>}
                        {row.tubes.map((tube, index) => (
                          <div key={tube.id ?? `${index}-${tube.specimenName ?? ''}`} className="flex max-w-full items-center gap-1.5 text-[12.5px] font-medium text-slate-700">
                            <CapColorDot color={tube.capColor} />
                            <span className="truncate">
                              {tube.capLabel ?? 'Ống'}
                              {!tube.sid && tube.specimenName ? ` · ${tube.specimenName}` : ''}
                            </span>
                            {tube.sid && <span className="flex-none font-bold tabular-nums text-slate-900">{tube.sid}</span>}
                          </div>
                        ))}
                      </div>
                    ) : columnKind === 'lab-collected' ? (
                      <>
                        <div className="flex min-w-0 flex-col items-start gap-1 px-3 py-1.5 text-left">
                          {row.tubes.length === 0 && <span className="text-slate-400">—</span>}
                          {row.tubes.map((tube, index) => (
                            <div key={tube.id ?? index} className="flex items-center gap-1.5 text-[12.5px] font-bold tabular-nums text-slate-900">
                              <CapColorDot color={tube.capColor} size={12} />
                              {tube.sid}
                            </div>
                          ))}
                        </div>
                        <div className="px-2">
                          {row.collectedAt ? (
                            <>
                              <div className="font-semibold text-slate-900">{formatClockTime(row.collectedAt)}</div>
                              <div className="truncate text-[11.5px] text-slate-500" title={row.collectedByName ?? undefined}>
                                {row.collectedByName ?? ''}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </div>
                        <div className="px-2">{row.hasDraft ? <StatusBadge tone="warning">Đang nhập</StatusBadge> : <StatusBadge tone="neutral">Chưa nhập</StatusBadge>}</div>
                      </>
                    ) : group === 'lab' ? (
                      <div className="px-2 font-medium text-slate-600">{row.specimenNames.length > 0 ? row.specimenNames.join(', ') : '—'}</div>
                    ) : (
                      <>
                        <div className="px-2">
                          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{row.serviceKind === 'FUNCTIONAL' ? 'Thăm dò CN' : 'CĐHA'}</span>
                        </div>
                        <div className="px-2 font-medium text-slate-600">{row.departmentName ?? '—'}</div>
                      </>
                    )}
                    {columnKind !== 'lab-collected' && (
                      <>
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
                      </>
                    )}
                    <div className="flex items-center justify-center gap-1.5 px-2">
                      {/* Dòng chưa thu tiền không có nút chính — trạng thái đã hiện ở cột "Thanh toán" nên không lặp lại chữ ở đây. */}
                      {action && (
                        <Button type="button" className="whitespace-nowrap px-3" onClick={action.run} loading={action.loading}>
                          {action.label}
                        </Button>
                      )}
                      <Button type="button" variant="secondary" className="flex-shrink-0 px-2.5" aria-label={`Xem chi tiết phiếu ${row.orderNo}`} title="Xem chi tiết phiếu" onClick={() => setQuickViewRow(row)}>
                        <Eye size={16} weight="regular" aria-hidden="true" />
                      </Button>
                      {columnKind === 'lab-collected' && canEnter && (
                        <RowActionMenu
                          label={`Thao tác khác của phiếu ${row.orderNo}`}
                          items={[
                            {
                              key: 'reprint',
                              label: 'In lại tem ống mẫu',
                              description: 'Mở hộp thoại ống mẫu để in lại tem (giữ nguyên mã ống)',
                              icon: <Printer size={15} weight="bold" aria-hidden="true" />,
                              onClick: () => setCollection({ orderId: row.orderId, initialSid: null }),
                            },
                            {
                              key: 'uncollect',
                              label: 'Huỷ xác nhận đã lấy mẫu',
                              description: row.hasDraft
                                ? 'Đã có bản nháp kết quả — không huỷ được'
                                : row.tubes.some((t) => t.id !== null)
                                  ? 'Trả phiếu về “Chờ lấy mẫu”, bắt buộc nhập lý do'
                                  : 'Phiếu lấy mẫu trước khi có ống mẫu — không huỷ được',
                              icon: <ArrowCounterClockwise size={15} weight="bold" aria-hidden="true" />,
                              danger: true,
                              disabled: row.hasDraft || !row.tubes.some((t) => t.id !== null),
                              onClick: () => setUncollectRow(row),
                            },
                          ]}
                        />
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
      {quickViewRow && <ParaclinicalOrderQuickViewDialog row={quickViewRow} group={group} onClose={() => setQuickViewRow(null)} />}
      {collection && <SpecimenCollectionDialog orderId={collection.orderId} initialSid={collection.initialSid} onClose={() => setCollection(null)} />}
      {uncollectRow && (
        <SpecimenUncollectDialog
          orderNo={uncollectRow.orderNo}
          tubeIds={uncollectRow.tubes.flatMap((t) => (t.id ? [t.id] : []))}
          onClose={() => setUncollectRow(null)}
          onDone={() => setUncollectRow(null)}
        />
      )}
    </div>
  );
}
