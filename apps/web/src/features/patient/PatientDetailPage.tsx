import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IdentificationCard } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { EmptyState } from '../../shared/ui/EmptyState';
import { Skeleton } from '../../shared/ui/Skeleton';
import { usePatientQuery, useUpdatePatientMutation } from './patient.queries';
import { PatientFormFields, type PatientFormValues } from './PatientFormFields';
import { patientDetailToFormValues, toUpdatePatientRequest } from './patient-form.utils';

const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' };
/** Khớp `patient.update` trong ma trận mặc định (.claude/docs/security-audit.md) — chỉ 2 vai trò. */
const PATIENT_EDIT_ROLES = ['receptionist', 'clinic_admin'];

/** Chi tiết + sửa TẠI CHỖ (không modal, đã chốt với chủ dự án) — cùng bố cục PatientFormFields cho cả xem/sửa. */
export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const patientId = id!;
  const query = usePatientQuery(patientId);
  const updateMutation = useUpdatePatientMutation(patientId);
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.roles.some((role) => PATIENT_EDIT_ROLES.includes(role)) ?? false;

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

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{patient.fullName}</h1>
          <p className="text-sm text-slate-500">
            Mã BN {patient.patientCode} · {GENDER_LABEL[patient.gender]}
          </p>
        </div>
        {!editing && canEdit && <Button onClick={startEditing}>Sửa hồ sơ</Button>}
      </div>

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
    </div>
  );
}
