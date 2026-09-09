import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IdentificationCard, Warning } from '@phosphor-icons/react';
import type { PatientSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useHasPermission } from '../auth/usePermission';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { EmptyState } from '../../shared/ui/EmptyState';
import { Skeleton } from '../../shared/ui/Skeleton';
import { PatientSearchDialog } from '../reception/PatientSearchDialog';
import { usePatientQuery, usePatientClinicalSummaryQuery, useUpdatePatientMutation } from './patient.queries';
import type { PatientFormValues } from './PatientFormFields';
import { PatientHistoryDialog } from './PatientHistoryDialog';
import { MergePatientsDialog } from './MergePatientsDialog';
import { patientDetailToFormValues, buildHistoryUpdatePayload } from './patient-form.utils';
import { PatientProfileHeader } from './PatientProfileHeader';
import { PatientClinicalKpiRow } from './PatientClinicalKpiRow';
import { PatientAdministrativeInfoCard } from './PatientAdministrativeInfoCard';
import { PatientVitalHistoryTable } from './PatientVitalHistoryTable';
import { PatientHistorySummaryCard } from './PatientHistorySummaryCard';
import { PatientEditDialog } from './PatientEditDialog';
import { PatientWalletTab } from '../patient-wallet/PatientWalletTab';

type ProfileTabId = 'info' | 'wallet' | 'record' | 'history';

const TABS: { id: ProfileTabId; label: string; comingSoon: boolean }[] = [
  { id: 'info', label: 'Thông tin cá nhân', comingSoon: false },
  { id: 'wallet', label: 'Ví tạm ứng', comingSoon: false },
  { id: 'record', label: 'Hồ sơ bệnh án', comingSoon: true },
  { id: 'history', label: 'Lịch sử khám chữa bệnh', comingSoon: true },
];

/**
 * "Hồ sơ bệnh nhân" — bố cục mới (mockup đã duyệt qua nhiều vòng, 2026-09-08): dải định danh NGANG
 * + dải KPI 2 tầng + tab (chỉ "Thông tin cá nhân" xây đầy đủ đợt này, 2 tab còn lại "Sắp có").
 * "Sửa hồ sơ" đổi từ sửa-tại-chỗ sang dialog riêng (`PatientEditDialog`).
 */
export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const patientId = id!;
  const query = usePatientQuery(patientId);
  const summaryQuery = usePatientClinicalSummaryQuery(patientId);
  const updateHistoryMutation = useUpdatePatientMutation(patientId);
  const canEdit = useHasPermission('patient', 'update');
  const canMerge = useHasPermission('patient', 'merge');

  const [activeTab, setActiveTab] = useState<ProfileTabId>('info');
  const [editing, setEditing] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [searchingMergeTarget, setSearchingMergeTarget] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<PatientSummary | null>(null);

  useBreadcrumb([
    { label: 'Hồ sơ Bệnh nhân' },
    { label: 'Danh sách bệnh nhân', to: '/patients' },
    { label: query.data?.fullName ?? 'Đang tải...' },
  ]);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-5 p-6">
        <Skeleton className="h-[104px] w-full rounded-lg" />
        <Skeleton className="h-[132px] w-full rounded-lg" />
        <Skeleton className="h-10 w-80 rounded-full" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (query.isError) {
    const err = query.error;
    if (err instanceof ApiError && err.code === 'NOT_FOUND') {
      return (
        <EmptyState
          icon={IdentificationCard}
          title="Không tìm thấy hồ sơ"
          description="Hồ sơ bệnh nhân này không tồn tại hoặc đã bị chuyển sang phòng khám khác."
          action={
            <Link to="/patients">
              <Button type="button">Về danh sách bệnh nhân</Button>
            </Link>
          }
        />
      );
    }
    return (
      <ErrorBanner
        message={err instanceof ApiError ? err.message : 'Không tải được hồ sơ bệnh nhân.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const patient = query.data;
  const merged = patient.mergedIntoId !== null;

  function handlePatientHistoryChange(values: PatientFormValues) {
    updateHistoryMutation.mutate(buildHistoryUpdatePayload(values, patient.version));
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <h1 className="sr-only">Hồ sơ bệnh nhân {patient.fullName}</h1>

      {merged && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Warning size={18} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>
            Hồ sơ này đã được gộp vào hồ sơ khác, không còn tạo được lượt khám mới.{' '}
            <Link to={`/patients/${patient.mergedIntoId}`} className="font-semibold underline">
              Xem hồ sơ đích
            </Link>
          </span>
        </div>
      )}

      <PatientProfileHeader
        patient={patient}
        canEdit={canEdit}
        canMerge={canMerge}
        merged={merged}
        onEdit={() => setEditing(true)}
        onMerge={() => setSearchingMergeTarget(true)}
      />

      <PatientClinicalKpiRow
        totalCompletedVisits={summaryQuery.data?.totalCompletedVisits ?? 0}
        lastCompletedVisitAt={summaryQuery.data?.lastCompletedVisitAt ?? null}
        vitalSigns={summaryQuery.data?.recentVitalSigns ?? []}
        allergenCount={patient.allergens.length}
      />
      {summaryQuery.isError && <ErrorBanner message="Không tải được số liệu lâm sàng." onRetry={() => void summaryQuery.refetch()} />}

      <div className="flex gap-1.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            disabled={tab.comingSoon}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : tab.comingSoon
                  ? 'cursor-not-allowed text-slate-400'
                  : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {tab.label}
            {tab.comingSoon && (
              <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">Sắp có</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'info' && (
        <div className="flex flex-col gap-5">
          <PatientAdministrativeInfoCard patient={patient} onEdit={canEdit ? () => setEditing(true) : undefined} />
          <PatientVitalHistoryTable vitalSigns={summaryQuery.data?.recentVitalSigns ?? []} />
          <PatientHistorySummaryCard
            conditions={patient.conditions}
            familyHistoryRows={patient.familyHistoryRows}
            personalHistory={patient.personalHistory}
            onAdd={() => setHistoryDialogOpen(true)}
          />
        </div>
      )}
      {activeTab === 'wallet' && <PatientWalletTab patientId={patient.id} />}
      {activeTab === 'record' && (
        <EmptyState icon={IdentificationCard} title="Hồ sơ bệnh án — sắp ra mắt" description="Tổng hợp dị ứng, bệnh lý nền, chẩn đoán và đơn thuốc theo thời gian tại một chỗ." />
      )}
      {activeTab === 'history' && (
        <EmptyState icon={IdentificationCard} title="Lịch sử khám chữa bệnh — sắp ra mắt" description="Danh sách mọi lượt khám của bệnh nhân, mở chi tiết từng lượt." />
      )}

      <PatientHistoryDialog
        open={historyDialogOpen}
        onClose={() => setHistoryDialogOpen(false)}
        values={patientDetailToFormValues(patient)}
        onChange={handlePatientHistoryChange}
      />

      {editing && <PatientEditDialog patient={patient} onClose={() => setEditing(false)} />}

      {searchingMergeTarget && (
        <PatientSearchDialog
          excludeId={patient.id}
          onClose={() => setSearchingMergeTarget(false)}
          onPick={(target) => {
            setSearchingMergeTarget(false);
            setMergeTarget(target);
          }}
        />
      )}

      {mergeTarget && (
        <MergePatientsDialog
          mode="confirm"
          source={patient}
          target={mergeTarget}
          onClose={() => setMergeTarget(null)}
          onSuccess={() => setMergeTarget(null)}
        />
      )}
    </div>
  );
}
