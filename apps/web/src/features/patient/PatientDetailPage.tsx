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
import { usePatientQuery, useUpdatePatientMutation } from './patient.queries';
import { PatientFormFields, type PatientFormValues } from './PatientFormFields';
import { MergePatientsDialog } from './MergePatientsDialog';
import { patientDetailToFormValues, toUpdatePatientRequest } from './patient-form.utils';

const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' };

/** Chi tiết + sửa TẠI CHỖ (không modal, đã chốt với chủ dự án) — cùng bố cục PatientFormFields cho cả xem/sửa. */
export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const patientId = id!;
  const query = usePatientQuery(patientId);
  const updateMutation = useUpdatePatientMutation(patientId);
  const canEdit = useHasPermission('patient', 'update');
  const canMerge = useHasPermission('patient', 'merge');
  const [searchingMergeTarget, setSearchingMergeTarget] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<PatientSummary | null>(null);

  useBreadcrumb([
    { label: 'Tiếp nhận và Đặt lịch' },
    { label: 'Danh sách bệnh nhân', to: '/patients' },
    { label: query.data?.fullName ?? 'Đang tải...' },
  ]);

  const [editing, setEditing] = useState(false);
  const [formValues, setFormValues] = useState<PatientFormValues | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-40" />
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

  function startEditing() {
    setApiError(null);
    setFormValues(patientDetailToFormValues(patient));
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setFormValues(null);
    setApiError(null);
  }

  async function save() {
    if (!formValues) return;
    setApiError(null);
    try {
      await updateMutation.mutateAsync(toUpdatePatientRequest(formValues, patient.version));
      setEditing(false);
      setFormValues(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONCURRENT_MODIFICATION') {
        await query.refetch();
        setEditing(false);
        setFormValues(null);
      }
      setApiError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  const merged = patient.mergedIntoId !== null;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{patient.fullName}</h1>
          <p className="text-sm text-slate-500">
            Mã BN {patient.patientCode} · {GENDER_LABEL[patient.gender]}
          </p>
        </div>
        <div className="flex gap-2.5">
          {!editing && !merged && canMerge && (
            <Button type="button" variant="secondary" onClick={() => setSearchingMergeTarget(true)}>
              Gộp vào hồ sơ khác
            </Button>
          )}
          {!editing && !merged && canEdit && <Button onClick={startEditing}>Sửa hồ sơ</Button>}
        </div>
      </div>

      {merged && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Warning size={18} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>
            Hồ sơ này đã được gộp vào hồ sơ khác, không còn tạo được lượt khám mới.{' '}
            <Link to={`/patients/${patient.mergedIntoId}`} className="font-semibold underline">
              Xem hồ sơ đích
            </Link>
          </span>
        </div>
      )}

      {apiError && (
        <p role="alert" className="mb-6 text-sm text-rose-600">
          {apiError}
        </p>
      )}

      <div className="rounded-lg bg-white p-6 shadow-sm">
        <PatientFormFields
          values={editing && formValues ? formValues : patientDetailToFormValues(patient)}
          onChange={setFormValues}
          disabled={!editing}
          patientId={patient.id}
          patientCode={patient.patientCode}
          photoUrl={patient.photoUrl}
          version={patient.version}
        />

        {editing && (
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={cancelEditing}>
              Huỷ
            </Button>
            <Button type="button" loading={updateMutation.isPending} onClick={() => void save()}>
              Lưu
            </Button>
          </div>
        )}
      </div>

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
