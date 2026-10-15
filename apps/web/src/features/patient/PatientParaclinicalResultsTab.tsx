import { useCallback, useMemo, useRef, useState } from 'react';
import { CalendarCheck, ChartLineUp, ClipboardText, MagnifyingGlass, Warning } from '@phosphor-icons/react';
import type { PatientParaclinicalResultRow } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatCardRow, type StatCardItem } from '../../shared/ui/StatCard';
import { addDaysToDateString, formatDateStringVi, toVietnamDateString } from '../encounter/follow-up-date';
import { PARACLINICAL_GROUP_META, type ParaclinicalGroup } from '../paraclinical-result/paraclinical-group';
import { ParaclinicalResultQuickPrint } from '../paraclinical-result/ParaclinicalResultQuickPrint';
import { ParaclinicalResultViewDialog } from '../paraclinical-result/ParaclinicalResultViewDialog';
import { usePatientIndicatorsQuery, usePatientParaclinicalResultsQuery } from '../paraclinical-result/patient-paraclinical.queries';
import type { PatientParaclinicalResultsParams } from '../paraclinical-result/patient-paraclinical.api';
import { useCanViewResultContent } from '../paraclinical-result/useCanViewResultContent';
import { PatientIndicatorTrend } from './PatientIndicatorTrend';
import { PatientParaclinicalResultList } from './PatientParaclinicalResultList';

type ViewMode = 'list' | 'trend';

const PERIOD_OPTIONS = [
  { value: '', label: 'Tất cả' },
  { value: '90', label: '3 tháng gần nhất' },
  { value: '180', label: '6 tháng gần nhất' },
  { value: '365', label: '12 tháng gần nhất' },
];

const UNFILTERED: PatientParaclinicalResultsParams = { abnormalOnly: false };

/** Tab "Kết quả cận lâm sàng" có hiện cho tài khoản này không: ít nhất một nhóm mà tài khoản có quyền làm chuyên môn (Nhập hoặc Duyệt). Lễ tân chỉ có quyền Xem nên không thấy tab. */
export function useCanSeePatientParaclinicalTab(): boolean {
  const lab = useCanViewResultContent('lab');
  const imaging = useCanViewResultContent('imaging');
  return lab || imaging;
}

/**
 * Tab "Kết quả cận lâm sàng" ở Hồ sơ bệnh nhân (docs/DECISIONS.md #234, mockup Artifact đã duyệt 14/10/2026): mọi kết quả ĐÃ DUYỆT của bệnh nhân — kết quả đi theo người bệnh nên gồm MỌI chi nhánh
 * (dòng chi nhánh khác nền xanh nhạt, như tab Lịch sử khám) — để bác sĩ đối chiếu kết quả cũ và theo dõi diễn biến chỉ số qua các lần đo. Hai tab con theo quyền (Xét nghiệm / CĐHA & Thăm dò
 * chức năng); xét nghiệm có thêm "Diễn biến chỉ số". Chỉ đọc: xem và in dùng lại hộp thoại/phiếu in của menu Cận lâm sàng.
 */
export function PatientParaclinicalResultsTab({ patientId }: { patientId: string }) {
  const canLab = useCanViewResultContent('lab');
  const canImaging = useCanViewResultContent('imaging');
  const tabs = useMemo(() => [...(canLab ? (['lab'] as const) : []), ...(canImaging ? (['imaging'] as const) : [])], [canLab, canImaging]);
  const [chosenGroup, setChosenGroup] = useState<ParaclinicalGroup>(canLab ? 'lab' : 'imaging');
  // Quyền có thể đổi sau khi mở trang; nhóm đang chọn không còn quyền → rơi về nhóm còn lại.
  const group: ParaclinicalGroup = tabs.includes(chosenGroup) ? chosenGroup : (tabs[0] ?? 'lab');
  const isLab = group === 'lab';

  const [view, setView] = useState<ViewMode>('list');
  const effectiveView: ViewMode = isLab ? view : 'list';
  const [period, setPeriod] = useState('');
  const [search, setSearch] = useState('');
  const [abnormalOnly, setAbnormalOnly] = useState(false);
  const q = useDebouncedValue(search.trim(), 300);

  const today = useMemo(() => toVietnamDateString(new Date().toISOString()), []);
  const params: PatientParaclinicalResultsParams = useMemo(
    () => ({
      dateFrom: period ? (addDaysToDateString(today, -(Number(period) - 1)) ?? undefined) : undefined,
      q: q || undefined,
      abnormalOnly: isLab && abnormalOnly,
    }),
    [period, today, q, isLab, abnormalOnly],
  );
  const filtered = params.dateFrom !== undefined || params.q !== undefined || params.abnormalOnly;

  // Bộ đếm hai nhóm (không lọc) cho nhãn tab con; nhóm đang xem dùng bộ lọc riêng. Cùng khoá cache với nhóm không lọc nên không tải thừa.
  const labCount = usePatientParaclinicalResultsQuery('lab', patientId, UNFILTERED, canLab);
  const imagingCount = usePatientParaclinicalResultsQuery('imaging', patientId, UNFILTERED, canImaging);
  const query = usePatientParaclinicalResultsQuery(group, patientId, params, tabs.length > 0);
  const indicators = usePatientIndicatorsQuery(patientId, isLab && effectiveView === 'trend');

  const first = query.data?.pages[0];
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const multiBranch = first?.multiBranch ?? false;
  const summary = first?.summary;

  const [viewing, setViewing] = useState<{ group: ParaclinicalGroup; itemId: string } | null>(null);
  const [printJob, setPrintJob] = useState<{ itemId: string; group: ParaclinicalGroup; nonce: number } | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const nonceRef = useRef(0);
  const startPrint = useCallback(
    (row: PatientParaclinicalResultRow) => {
      setPrintError(null);
      nonceRef.current += 1;
      setPrintJob({ itemId: row.itemId, group, nonce: nonceRef.current });
    },
    [group],
  );
  const endPrint = useCallback(() => setPrintJob(null), []);
  const failPrint = useCallback((message: string) => {
    setPrintError(message);
    setPrintJob(null);
  }, []);
  const { fetchNextPage } = query;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  const statItems = useMemo<StatCardItem[]>(() => {
    if (!summary) return [];
    const latest = summary.latestSignedAt ? formatDateStringVi(toVietnamDateString(summary.latestSignedAt)) : '—';
    const first = summary.firstSignedAt ? formatDateStringVi(toVietnamDateString(summary.firstSignedAt)) : null;
    const items: StatCardItem[] = [
      { icon: ClipboardText, tone: 'blue', label: 'Kết quả đã duyệt', value: String(summary.totalApproved), hint: first ? `từ ${first} đến ${latest}` : undefined },
    ];
    if (isLab) {
      items.push({ icon: Warning, tone: summary.abnormalResults > 0 ? 'rose' : 'slate', label: 'Có chỉ số bất thường', value: String(summary.abnormalResults), hint: `trên ${summary.totalApproved} kết quả` });
      items.push({ icon: ChartLineUp, tone: 'emerald', label: 'Chỉ số theo dõi được', value: String(summary.trackableIndicators), hint: 'có từ 3 lần đo trở lên' });
    } else {
      for (const c of summary.byCategory.slice(0, 3)) items.push({ icon: ClipboardText, tone: 'slate', label: c.name, value: String(c.count) });
    }
    items.push({ icon: CalendarCheck, tone: 'slate', label: 'Kết quả gần nhất', value: latest, hint: summary.latestServiceNames.length > 0 ? summary.latestServiceNames.join(' · ') : undefined });
    return items;
  }, [summary, isLab]);

  if (tabs.length === 0) return null;

  const openFromTrend = (itemId: string) => setViewing({ group: 'lab', itemId });

  return (
    <div className="flex flex-col gap-3">
      {query.isPending ? (
        <Skeleton className="h-[84px] w-full rounded-xl" />
      ) : (
        statItems.length > 0 && (
          <div className="flex">
            <StatCardRow items={statItems} />
          </div>
        )
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <SegmentedToggle
          ariaLabel="Nhóm kết quả"
          value={group}
          onChange={setChosenGroup}
          items={tabs.map((id) => ({
            id,
            label: PARACLINICAL_GROUP_META[id].label,
            count: (id === 'lab' ? labCount : imagingCount).data?.pages[0]?.summary.totalApproved,
          }))}
        />
        {isLab && (
          <SegmentedToggle
            ariaLabel="Kiểu xem"
            value={effectiveView}
            onChange={setView}
            items={[
              { id: 'list', label: 'Danh sách kết quả' },
              { id: 'trend', label: 'Diễn biến chỉ số' },
            ]}
          />
        )}
      </div>

      {/* Hàng bộ lọc riêng (chỉ ở kiểu xem danh sách): luôn nằm dưới hàng chọn nhóm nên không bị rớt dòng lộn xộn khi màn hẹp. */}
      {effectiveView === 'list' && (
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-52">
            <Combobox id="ppr-period" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} placeholder="Khoảng thời gian" dense />
          </div>
          <div className="relative min-w-56 flex-1">
            <MagnifyingGlass size={15} weight="regular" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên dịch vụ, mã phiếu…"
              aria-label="Tìm kết quả"
              className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-[13px] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          {isLab && (
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={abnormalOnly} onChange={(e) => setAbnormalOnly(e.target.checked)} className="h-4 w-4" />
              Chỉ kết quả có chỉ số bất thường
            </label>
          )}
        </div>
      )}

      {printError && <ErrorBanner message={printError} />}

      {effectiveView === 'trend' ? (
        indicators.isPending ? (
          <Skeleton className="h-80 w-full rounded-lg" />
        ) : indicators.isError ? (
          <ErrorBanner message={indicators.error instanceof ApiError ? indicators.error.message : 'Không tải được danh sách chỉ số.'} onRetry={() => void indicators.refetch()} />
        ) : (
          <PatientIndicatorTrend patientId={patientId} indicators={indicators.data.items} onOpenResult={openFromTrend} />
        )
      ) : query.isPending ? (
        <Skeleton className="h-72 w-full rounded-lg" />
      ) : query.isError ? (
        <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được kết quả cận lâm sàng.'} onRetry={() => void query.refetch()} />
      ) : (
        <PatientParaclinicalResultList
          group={group}
          rows={rows}
          multiBranch={multiBranch}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadMore={loadMore}
          onView={(row) => setViewing({ group, itemId: row.itemId })}
          onPrint={startPrint}
          filtered={filtered}
        />
      )}

      <p className="text-xs font-medium text-slate-500">
        {effectiveView === 'trend'
          ? 'Dải xanh là khoảng tham chiếu của lần đo gần nhất; bảng ghi khoảng tham chiếu đúng của từng lần. Bấm một điểm hoặc nút Xem để mở kết quả của lần đó.'
          : 'Mới nhất ở trên · cuộn xuống tự tải thêm · tiêu đề đứng yên khi cuộn.'}
      </p>
      {multiBranch && effectiveView === 'list' && <p className="text-xs font-medium text-slate-500">Dòng nền xanh nhạt là kết quả ở chi nhánh khác, nội dung xem đầy đủ.</p>}

      {viewing && <ParaclinicalResultViewDialog group={viewing.group} itemId={viewing.itemId} patientId={patientId} onClose={() => setViewing(null)} />}
      {printJob && <ParaclinicalResultQuickPrint key={printJob.nonce} group={printJob.group} itemId={printJob.itemId} patientId={patientId} onDone={endPrint} onError={failPrint} />}
    </div>
  );
}
