import { useMemo, useState } from 'react';
import { CheckCircle, IdentificationCard, Printer } from '@phosphor-icons/react';
import type { PatientDetail, PatientEncounterHistoryItem } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ListLoadError } from '../../shared/ui/ListLoadError';
import { RecordLoadError } from '../../shared/ui/RecordLoadError';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDateTimeVn } from '../../shared/format/time';
import { useHasPermission } from '../auth/usePermission';
import { useConsultationDetailQuery, usePatientEncounterHistoryQuery } from '../encounter/encounter.queries';
import { useAllWardsQuery, useProvincesQuery } from '../geo/geo.queries';
import { MedicalRecordExportDialog } from '../patient/MedicalRecordExportDialog';
import { GENDER_LABEL, computeAgeLabel, computeBirthYear } from '../patient/patient-form.utils';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { MedicalRecordFieldsView } from './MedicalRecordFieldsView';
import { MedicalRecordSheet } from './MedicalRecordSheet';
import { buildFieldGroups, buildMedicalRecordView, bundleSummary, type RecordPatientInfo } from './medical-record-model';
import { useMedicalRecordParaclinicalQuery } from './medical-record.queries';

type ViewMode = 'form' | 'fields';
const VIEW_MODES = [
  { id: 'form', label: 'Theo mẫu Bộ Y tế' },
  { id: 'fields', label: 'Theo trường dữ liệu' },
] as const;

function codeNameMap(items: { code: string; name: string }[] | undefined): Record<string, string> {
  return Object.fromEntries((items ?? []).map((i) => [i.code, i.name]));
}

/** Giải mã tên (dân tộc, quốc tịch, nghề nghiệp, tỉnh/phường) của bệnh nhân thành các ô chữ của mục I — cùng cách `PatientAdministrativeInfoCard` đang làm. */
function useRecordPatientInfo(patient: PatientDetail): RecordPatientInfo {
  const provinces = useProvincesQuery();
  const wards = useAllWardsQuery();
  const ethnicity = useReferenceCatalogQuery('ETHNICITY');
  const nationality = useReferenceCatalogQuery('NATIONALITY');
  const occupation = useReferenceCatalogQuery('OCCUPATION');
  return useMemo(() => {
    const provinceName = codeNameMap(provinces.data?.items);
    const wardName = codeNameMap(wards.data?.items);
    const ethnicityName = codeNameMap(ethnicity.data?.items);
    const nationalityName = codeNameMap(nationality.data?.items);
    const occupationName = codeNameMap(occupation.data?.items);
    const a = patient.address;
    const address = [a?.street, a?.neighborhood, a?.ward ? (wardName[a.ward] ?? a.ward) : '', a?.province ? (provinceName[a.province] ?? a.province) : ''].filter(Boolean).join(', ');
    const relativeBits = [patient.relativeFullName, patient.relativeRelationship ? `(${patient.relativeRelationship})` : '', patient.relativePhone ? `— ${patient.relativePhone}` : ''].filter(Boolean);
    return {
      fullName: patient.fullName,
      birthYearAndAge: `${computeBirthYear(patient.dob)} · ${computeAgeLabel(patient.dob)}`,
      gender: GENDER_LABEL[patient.gender] ?? patient.gender,
      occupation: patient.occupation ? (occupationName[patient.occupation] ?? patient.occupation) : '',
      ethnicity: patient.ethnicity ? (ethnicityName[patient.ethnicity] ?? patient.ethnicity) : '',
      nationality: patient.nationality ? (nationalityName[patient.nationality] ?? patient.nationality) : '',
      nationalId: patient.nationalId ?? '',
      phone: patient.phone,
      address,
      relative: relativeBits.join(' '),
    };
  }, [patient, provinces.data, wards.data, ethnicity.data, nationality.data, occupation.data]);
}

/** Cột trái: các lần khám đã hoàn tất, mới nhất trước. Màn rộng xếp dọc; dưới `lg` thu thành dải ngang cuộn được phía trên phiếu (đúng mockup đã chốt). */
function EncounterTimeline({
  items,
  total,
  selectedId,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  items: PatientEncounterHistoryItem[];
  total: number;
  selectedId: string;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <aside className="w-full shrink-0 overflow-hidden rounded-[10px] border border-slate-200 bg-white lg:w-[290px]" aria-label="Các lần khám">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">Các lần khám</h2>
        <span className="text-xs tabular-nums text-slate-500">{total} lượt</span>
      </div>
      <ul className="flex overflow-x-auto lg:block lg:overflow-visible">
        {items.map((it) => {
          const selected = it.encounterId === selectedId;
          return (
            <li key={it.encounterId} className="min-w-[236px] border-r border-slate-100 lg:min-w-0 lg:border-b lg:border-r-0">
              <button
                type="button"
                onClick={() => onSelect(it.encounterId)}
                aria-current={selected ? 'true' : undefined}
                className={`flex w-full flex-col gap-0.5 border-l-[3px] px-3 py-2.5 text-left ${selected ? 'border-brand-teal bg-brand-teal-tint' : 'border-transparent bg-white hover:bg-slate-50'}`}
              >
                <span className="flex items-center justify-between gap-1.5">
                  <span className="text-[13.5px] font-semibold tabular-nums text-slate-900">{formatDateTimeVn(it.checkedInAt).slice(0, 10)}</span>
                  <StatusBadge tone="success">Đã ký</StatusBadge>
                </span>
                <span className="text-[11.5px] tabular-nums text-slate-600">Số BA {it.recordNo ?? '—'}</span>
                <span className="flex min-w-0 items-baseline gap-1.5">
                  {it.clinical?.primaryDiagnosisCode && <span className="shrink-0 text-[11px] font-semibold tabular-nums text-blue-700">{it.clinical.primaryDiagnosisCode}</span>}
                  <span className="truncate text-[12.5px] text-slate-900">{it.clinical?.primaryDiagnosisName ?? 'Chưa có chẩn đoán'}</span>
                </span>
                <span className="truncate text-[11.5px] text-slate-500">{[it.doctorName, it.branchName].filter(Boolean).join(' · ') || '—'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="border-t border-slate-100 p-2.5">
          <Button type="button" variant="secondary" className="w-full" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Đang tải…' : 'Tải thêm lượt khám'}
          </Button>
        </div>
      )}
    </aside>
  );
}

/** Phiếu của MỘT lượt khám: tải chi tiết + kết quả cận lâm sàng, dựng `MedicalRecordView`, rồi chọn cách xem. */
function MedicalRecordPane({ item, patient, showBranch }: { item: PatientEncounterHistoryItem; patient: PatientDetail; showBranch: boolean }) {
  const [mode, setMode] = useState<ViewMode>('form');
  // "In bộ hồ sơ" / "Xuất PDF" một lượt khám (#269): cùng quyền với "Xuất toàn bộ bệnh án"; người không có quyền không thấy nút.
  const canExport = useHasPermission('patient', 'export_medical_record');
  const [exportMode, setExportMode] = useState<'print' | 'download' | null>(null);
  const detailQuery = useConsultationDetailQuery(item.encounterId);
  const clsQuery = useMedicalRecordParaclinicalQuery(item.encounterId);
  const patientInfo = useRecordPatientInfo(patient);

  const view = useMemo(
    () => (detailQuery.data ? buildMedicalRecordView({ item, detail: detailQuery.data, paraclinical: clsQuery.data?.results ?? [], patient: patientInfo, showBranch }) : null),
    [item, detailQuery.data, clsQuery.data, patientInfo, showBranch],
  );
  const fieldGroups = useMemo(() => (view ? buildFieldGroups(view, item.doctorName) : []), [view, item.doctorName]);

  if (detailQuery.isPending) {
    return (
      <div className="min-w-0 flex-1 rounded-[10px] border border-slate-300 bg-white p-5" aria-busy="true" aria-label="Đang tải hồ sơ bệnh án">
        <Skeleton className="mb-4 h-6 w-64" />
        <Skeleton className="mb-3 h-24 w-full" />
        <Skeleton className="mb-3 h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (detailQuery.isError || view === null) {
    return (
      <div className="min-w-0 flex-1">
        <RecordLoadError error={detailQuery.error} fallbackMessage="Không tải được hồ sơ bệnh án của lượt khám này." onRetry={() => void detailQuery.refetch()} />
      </div>
    );
  }

  const paraclinicalState = clsQuery.isPending ? ({ state: 'loading' } as const) : clsQuery.isError ? ({ state: 'error' } as const) : ({ state: 'ready' } as const);

  return (
    <div className="min-w-0 flex-1 overflow-hidden rounded-[10px] border border-slate-300 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-[18px] py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-wide text-slate-900">BỆNH ÁN NGOẠI TRÚ</h2>
          <p className="mt-0.5 text-[12.5px] tabular-nums text-slate-600">
            Số bệnh án {view.recordNo ?? '—'} · Lượt khám {view.encounterNo} · Khám ngày {view.visitDate}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedToggle items={VIEW_MODES} value={mode} onChange={setMode} ariaLabel="Chế độ xem hồ sơ bệnh án" />
          {canExport && (
            <>
              <Button type="button" onClick={() => setExportMode('print')}>
                <Printer size={15} weight="bold" aria-hidden="true" className="mr-1.5" />
                In bộ hồ sơ
              </Button>
              <Button type="button" variant="secondary" onClick={() => setExportMode('download')}>
                Xuất PDF
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1.5 border-b border-slate-200 bg-slate-50 px-[18px] py-2.5 text-[12.5px] text-slate-600">
        {view.signedAt && (
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle size={14} weight="fill" className="text-emerald-600" aria-hidden="true" />
            Đã ký {formatDateTimeVn(view.signedAt)}
            {item.doctorName ? ` · ${item.doctorName}` : ''}
          </span>
        )}
        {view.amendNote && <span className="text-amber-800">{view.amendNote}</span>}
      </div>

      {mode === 'form' ? (
        <MedicalRecordSheet view={view} patientId={patient.id} paraclinical={paraclinicalState} onRetryParaclinical={() => void clsQuery.refetch()} />
      ) : (
        <MedicalRecordFieldsView groups={fieldGroups} />
      )}

      <div className="flex justify-end border-t border-slate-300 px-[18px] py-3">
        <div className="min-w-[190px] text-center">
          <div className="text-xs text-slate-500">Bác sĩ khám bệnh</div>
          <div className="mt-5 text-[13.5px] font-semibold text-slate-900">{item.doctorName ?? '—'}</div>
          <div className="text-xs tabular-nums text-slate-500">{view.signedAt ? formatDateTimeVn(view.signedAt) : ''}</div>
        </div>
      </div>

      {exportMode && (
        <MedicalRecordExportDialog
          patientId={patient.id}
          encounter={{ encounterId: item.encounterId, mode: exportMode, note: `Bộ hồ sơ gồm: ${bundleSummary(view)}.` }}
          onClose={() => setExportMode(null)}
        />
      )}
    </div>
  );
}

/**
 * Tab "Hồ sơ bệnh án" của Hồ sơ bệnh nhân (docs/DECISIONS.md #269, mockup đã chốt https://claude.ai/artifact/YafdgtM5rQBVMe9LXyLYfK): bệnh án điện tử theo mẫu bệnh án ngoại trú của Bộ Y tế,
 * MỖI LẦN KHÁM MỘT PHIẾU RIÊNG. Cột trái chọn lượt khám (chỉ lượt đã hoàn tất = bệnh án chính thức đã ký), cột phải là phiếu 10 mục I–X. CHỈ ĐỌC. Không có tiền/chi phí — phần đó ở tab "Lịch sử khám".
 */
export function PatientMedicalRecordTab({ patient }: { patient: PatientDetail }) {
  const historyQuery = usePatientEncounterHistoryQuery(patient.id, 'COMPLETED');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = useMemo(() => historyQuery.data?.pages.flatMap((p) => p.items) ?? [], [historyQuery.data]);
  const firstPage = historyQuery.data?.pages[0];

  if (historyQuery.isPending) {
    return (
      <div className="flex flex-col gap-3.5 lg:flex-row" aria-busy="true" aria-label="Đang tải hồ sơ bệnh án">
        <Skeleton className="h-64 w-full rounded-[10px] lg:w-[290px]" />
        <Skeleton className="h-96 w-full flex-1 rounded-[10px]" />
      </div>
    );
  }
  if (historyQuery.isError) {
    return <ListLoadError error={historyQuery.error} fallbackMessage="Không tải được danh sách lượt khám." onRetry={() => void historyQuery.refetch()} />;
  }
  if (firstPage && !firstPage.canViewClinical) {
    return <ErrorBanner message="Tài khoản của bạn không có quyền xem nội dung lâm sàng của hồ sơ bệnh án." />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={IdentificationCard}
        title="Chưa có hồ sơ bệnh án"
        description="Hồ sơ xuất hiện sau khi bác sĩ hoàn tất một lượt khám."
      />
    );
  }

  const selected = items.find((i) => i.encounterId === selectedId) ?? items[0]!;

  return (
    <div className="flex flex-col items-start gap-3.5 lg:flex-row">
      <EncounterTimeline
        items={items}
        total={firstPage?.completedCount ?? items.length}
        selectedId={selected.encounterId}
        onSelect={setSelectedId}
        hasMore={historyQuery.hasNextPage}
        loadingMore={historyQuery.isFetchingNextPage}
        onLoadMore={() => void historyQuery.fetchNextPage()}
      />
      {/* `key` theo lượt khám: đổi lượt thì chế độ xem quay về "Theo mẫu" và trạng thái tải tách bạch từng lượt. */}
      <MedicalRecordPane key={selected.encounterId} item={selected} patient={patient} showBranch={firstPage?.multiBranch ?? false} />
    </div>
  );
}
