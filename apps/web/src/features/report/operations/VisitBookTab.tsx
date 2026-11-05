import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, MagnifyingGlass } from '@phosphor-icons/react';
import { ApiError } from '../../../shared/api/client';
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue';
import { useInfiniteScrollSentinel } from '../../../shared/hooks/useInfiniteScrollSentinel';
import { formatVndPlain } from '../../../shared/format/currency';
import { ReportPrintAction } from '../../../shared/print/ReportPrintAction';
import { loadAllByCursor, PRINT_LOAD_PAGE_SIZE } from '../../../shared/print/load-all-pages';
import { REPORT_PRINT_ROW_CAP, type ReportPrintSpec } from '../../../shared/print/report-print-spec';
import { Combobox } from '../../../shared/ui/Combobox';
import { DateInput } from '../../../shared/ui/DateInput';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { InfiniteListFooter, InfiniteScrollTail } from '../../../shared/ui/InfiniteListFooter';
import { ListLoadError } from '../../../shared/ui/ListLoadError';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { useDoctorsQuery } from '../../appointment/appointment.queries';
import { ReportScopeControl } from '../../branch/ReportScopeControl';
import type { ReportScopeState } from '../../branch/useReportScope';
import { GENDER_LABEL } from '../../patient/patient-form.utils';
import { getVisitBook, type VisitBookParams } from './operations.api';
import { formatDayMonth } from './operations-model';
import { buildVisitBookPrintSpec } from './operations-print-builders';
import { useExportVisitBookMutation, useVisitBookQuery } from './operations.queries';
import { Icd10FilterCombobox } from './Icd10FilterCombobox';
import { periodError, resolvePeriod, type PeriodRange } from '../report-period';
import { getVietnamTodayDateString } from '../../appointment/schedule-grid.utils';
import { scopeText } from './PeriodReportTab';
import { ReportActionBar } from '../ReportActionBar';

/** Bảng theo mockup: STT, Ngày khám, Số lượt khám, Mã BN, Họ tên, Tuổi, Giới, [Chi nhánh], Chẩn đoán chính, Bác sĩ, Dịch vụ, Thành tiền, Xem. */
function gridTemplate(multiBranch: boolean): string {
  return ['44px', '84px', '130px', '120px', 'minmax(150px, 1.1fr)', '56px', '56px', ...(multiBranch ? ['minmax(110px, 0.7fr)'] : []), 'minmax(220px, 1.5fr)', 'minmax(130px, 0.9fr)', 'minmax(170px, 1.1fr)', '100px', '48px'].join(' ');
}

const HEADERS_BEFORE_BRANCH = ['STT', 'Ngày khám', 'Số lượt khám', 'Mã bệnh nhân', 'Họ tên', 'Tuổi', 'Giới'];
const HEADERS_AFTER_BRANCH = ['Chẩn đoán chính', 'Bác sĩ', 'Dịch vụ', 'Thành tiền', ''];
const CENTER_COLUMNS = new Set(['STT', 'Ngày khám', 'Số lượt khám', 'Mã bệnh nhân', 'Tuổi', 'Giới']);

function DoctorFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const doctors = useDoctorsQuery();
  const options = useMemo(() => [{ value: '', label: 'Tất cả bác sĩ' }, ...(doctors.data?.items ?? []).map((d) => ({ value: d.id, label: d.displayName ?? d.fullName }))], [doctors.data]);
  return (
    <div className="w-[200px]">
      <Combobox id="visit-book-doctor" value={value} options={options} onChange={onChange} placeholder="Tất cả bác sĩ" />
    </div>
  );
}

/**
 * Tab "Sổ khám bệnh" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): thay sổ giấy — danh sách lượt khám ĐÃ HOÀN TẤT theo khoảng ngày, mới nhất trước, lọc bác sĩ / mã ICD-10 / tìm tên-mã-SĐT,
 * cuộn tải thêm theo lô. Có Xuất Excel (đúng bộ lọc, tối đa 5.000 dòng) và In (tải đủ các trang rồi in, tối đa 5.000 dòng).
 */
export function VisitBookTab({ scope }: { scope: ReportScopeState }) {
  const today = getVietnamTodayDateString();
  // Đường dẫn "Xem" của trang báo cáo Bác sĩ mang sẵn bác sĩ và kỳ (`?doctorId=&from=&to=`); chỉ dùng làm giá trị khởi tạo, người dùng vẫn đổi được.
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState<PeriodRange>(() => {
    const linked = { from: searchParams.get('from') ?? '', to: searchParams.get('to') ?? '' };
    return periodError(linked) === null ? linked : resolvePeriod('thisMonth', today);
  });
  const [doctorId, setDoctorId] = useState(() => {
    const linked = searchParams.get('doctorId') ?? '';
    return /^[0-9a-f-]{36}$/i.test(linked) ? linked : '';
  });
  const [icd, setIcd] = useState({ code: '', name: '' });
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [exportError, setExportError] = useState<string | null>(null);

  const rangeError = periodError(range);
  const params: VisitBookParams = { from: range.from, to: range.to, ...scope.selection, doctorId, icd10Code: icd.code, q: debouncedQ };
  const query = useVisitBookQuery(params, rangeError === null);
  const exportMutation = useExportVisitBookMutation();

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const first = query.data?.pages[0];
  const total = first?.total ?? 0;
  const multiBranch = (first?.branchCount ?? 1) > 1;
  const nextPageFailed = query.isFetchNextPageError;
  const fetchMore = () => void query.fetchNextPage();
  const sentinelRef = useInfiniteScrollSentinel({ enabled: (query.hasNextPage ?? false) && !query.isFetchingNextPage && !query.isError, onReach: fetchMore, watchKey: items.length });
  const template = gridTemplate(multiBranch);
  const headers = [...HEADERS_BEFORE_BRANCH, ...(multiBranch ? ['Chi nhánh'] : []), ...HEADERS_AFTER_BRANCH];
  const minWidth = multiBranch ? 1440 : 1320;

  async function handleExport() {
    setExportError(null);
    try {
      await exportMutation.mutateAsync(params);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Không xuất được tệp Excel, vui lòng thử lại.');
    }
  }

  /** In: gọi thẳng API trang 100 dòng cho tới khi đủ hoặc chạm 5.000 dòng — không đi qua cuộn tải thêm của màn hình. */
  async function loadPrintSpec(): Promise<ReportPrintSpec> {
    const { pages } = await loadAllByCursor((cursor) => getVisitBook({ ...params, cursor, limit: PRINT_LOAD_PAGE_SIZE }), REPORT_PRINT_ROW_CAP);
    const rows = pages.flatMap((p) => p.items).slice(0, REPORT_PRINT_ROW_CAP);
    const filterLines = [icd.code ? `Chẩn đoán chính: ${icd.code}` : null, doctorId ? 'Đã lọc theo một bác sĩ' : null, debouncedQ.trim() ? `Tìm: ${debouncedQ.trim()}` : null].filter((l): l is string => l !== null);
    return buildVisitBookPrintSpec(rows, pages[0]?.total ?? rows.length, { from: params.from, to: params.to, scopeLabel: scopeText(scope.selection, pages[0]?.branchCount ?? 1), multiBranch: (pages[0]?.branchCount ?? 1) > 1, filterLines });
  }

  const hasFilter = doctorId !== '' || icd.code !== '' || debouncedQ.trim() !== '';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <ReportScopeControl scope={scope} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="visit-book-from" className="text-sm font-semibold text-slate-800">
              Từ ngày
            </label>
            <DateInput id="visit-book-from" value={range.from} onChange={(from) => setRange({ ...range, from })} dense />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="visit-book-to" className="text-sm font-semibold text-slate-800">
              Đến ngày
            </label>
            <DateInput id="visit-book-to" value={range.to} onChange={(to) => setRange({ ...range, to })} dense />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="visit-book-doctor" className="text-sm font-semibold text-slate-800">
              Bác sĩ
            </label>
            <DoctorFilter value={doctorId} onChange={setDoctorId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="visit-book-icd" className="text-sm font-semibold text-slate-800">
              Chẩn đoán
            </label>
            <Icd10FilterCombobox id="visit-book-icd" code={icd.code} name={icd.name} onChange={setIcd} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="visit-book-q" className="text-sm font-semibold text-slate-800">
              Tìm
            </label>
            <div className="relative w-[240px]">
              <MagnifyingGlass size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="visit-book-q"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tên, mã bệnh nhân, SĐT"
                className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>
        <ReportActionBar
          generatedAt={first?.generatedAt}
          onRefresh={() => void query.refetch()}
          refreshing={query.isFetching && !query.isPending}
          onExport={() => void handleExport()}
          exporting={exportMutation.isPending}
          exportDisabled={!first || rangeError !== null}
          exportSuffix={first ? ` (${total.toLocaleString('vi-VN')} dòng)` : undefined}
          print={<ReportPrintAction loadSpec={loadPrintSpec} disabled={!first || total === 0 || rangeError !== null} />}
        />
      </div>

      {rangeError !== null && <ErrorBanner message={rangeError} />}
      {exportError && <ErrorBanner message={exportError} />}

      {rangeError !== null ? null : query.isPending ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-busy="true" aria-label="Đang tải sổ khám bệnh">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ListLoadError error={query.error} fallbackMessage="Không tải được sổ khám bệnh." onRetry={() => void query.refetch()} fallbackTo="/reports" fallbackLabel="Về Trung tâm báo cáo" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={hasFilter ? 'Không có lượt khám nào khớp bộ lọc' : 'Không có lượt khám nào trong khoảng ngày này'}
          description={hasFilter ? 'Đổi hoặc bỏ bớt bộ lọc, hoặc mở rộng khoảng ngày.' : 'Sổ khám chỉ gồm các lượt khám đã hoàn tất. Đổi khoảng ngày hoặc phạm vi chi nhánh.'}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="scroll-hover min-h-0 flex-1 overflow-auto">
            <div role="table" aria-label="Sổ khám bệnh" style={{ minWidth }}>
              <div role="row" style={{ gridTemplateColumns: template }} className="sticky top-0 z-10 grid gap-x-3 border-b border-slate-100 bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {headers.map((h, i) => (
                  <div key={`${h}-${i}`} role="columnheader" className={h === 'Thành tiền' ? 'text-right' : CENTER_COLUMNS.has(h) ? 'text-center' : undefined}>
                    {h}
                  </div>
                ))}
              </div>
              {items.map((r, i) => (
                <div key={r.encounterId} role="row" style={{ gridTemplateColumns: template }} className="grid items-center gap-x-3 border-b border-slate-50 px-4 py-2.5 text-sm text-slate-800 hover:bg-slate-50">
                  <div role="cell" className="text-center text-slate-600 tabular-nums">{i + 1}</div>
                  <div role="cell" className="text-center font-medium">{formatDayMonth(r.visitDate)}</div>
                  <div role="cell" className="text-center font-semibold text-slate-800">{r.encounterNo}</div>
                  <div role="cell" className="text-center font-semibold text-slate-800">{r.patientCode}</div>
                  <div role="cell" className="min-w-0 truncate font-semibold text-slate-900" title={r.patientName}>{r.patientName}</div>
                  <div role="cell" className="text-center tabular-nums">{r.ageYears ?? ''}</div>
                  <div role="cell" className="text-center">{GENDER_LABEL[r.gender] ?? r.gender}</div>
                  {multiBranch && <div role="cell" className="min-w-0 truncate text-slate-700" title={r.branchName}>{r.branchName}</div>}
                  <div role="cell" className="min-w-0 truncate" title={r.diagnosisCode ? `${r.diagnosisCode} ${r.diagnosisName ?? ''}` : undefined}>
                    {r.diagnosisCode && (
                      <>
                        <span className="font-semibold">{r.diagnosisCode}</span> <span className="text-slate-700">{r.diagnosisName}</span>
                      </>
                    )}
                  </div>
                  <div role="cell" className="min-w-0 truncate text-slate-700" title={r.doctorName ?? undefined}>{r.doctorName ?? ''}</div>
                  <div role="cell" className="min-w-0 truncate text-slate-700" title={r.services.join('; ')}>{r.services.join('; ')}</div>
                  <div role="cell" className="text-right font-semibold tabular-nums text-slate-900">{formatVndPlain(r.amount)}</div>
                  <div role="cell">
                    <Link to={`/encounters/${r.encounterId}`} className="font-medium text-blue-700 hover:underline" aria-label={`Xem lượt khám ${r.encounterNo}`}>
                      Xem
                    </Link>
                  </div>
                </div>
              ))}
              <InfiniteScrollTail sentinelRef={sentinelRef} hasNextPage={query.hasNextPage ?? false} isFetchingNextPage={query.isFetchingNextPage} />
            </div>
          </div>
          <InfiniteListFooter loaded={items.length} total={total} hasNextPage={query.hasNextPage ?? false} isFetchingNextPage={query.isFetchingNextPage} isLoadMoreError={nextPageFailed} onRetry={fetchMore} />
        </div>
      )}
    </div>
  );
}

