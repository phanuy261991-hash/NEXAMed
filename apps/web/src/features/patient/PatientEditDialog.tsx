import { useState } from 'react';
import { UserCircle } from '@phosphor-icons/react';
import type { PatientDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { PatientFormFields, type PatientFormValues } from './PatientFormFields';
import { patientDetailToFormValues, toUpdatePatientRequest } from './patient-form.utils';
import { useUpdatePatientMutation } from './patient.queries';

/**
 * "Sửa hồ sơ" — dialog riêng (đổi từ sửa-tại-chỗ cũ của `PatientDetailPage.tsx`, đã hỏi và chốt lúc
 * duyệt mockup trang "Hồ sơ bệnh nhân"). Logic lưu/optimistic-lock RELOCATE nguyên vẹn từ bản cũ,
 * không viết lại — chỉ đổi nơi hiển thị.
 */
export function PatientEditDialog({ patient, onClose }: { patient: PatientDetail; onClose: () => void }) {
  const updateMutation = useUpdatePatientMutation(patient.id);
  const [formValues, setFormValues] = useState<PatientFormValues>(() => patientDetailToFormValues(patient));
  const [apiError, setApiError] = useState<string | null>(null);

  async function save() {
    setApiError(null);
    try {
      await updateMutation.mutateAsync(toUpdatePatientRequest(formValues, patient.version));
      onClose();
    } catch (err) {
      // Version cũ (đã bị sửa nơi khác) — hồ sơ dưới trang đã tự cập nhật qua cache, đóng dialog
      // luôn thay vì để bác sĩ/lễ tân sửa đè lên bản đã lỗi thời.
      if (err instanceof ApiError && err.code === 'CONCURRENT_MODIFICATION') {
        onClose();
        return;
      }
      setApiError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex-shrink-0 px-6 pt-6">
          <ModalHeader
            icon={UserCircle}
            title="Sửa hồ sơ bệnh nhân"
            right={<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Mã BN {patient.patientCode}</span>}
            onClose={onClose}
          />
        </div>

        <div className="scroll-hover flex-1 overflow-y-auto px-6">
          {apiError && (
            <p role="alert" className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {apiError}
            </p>
          )}
          <PatientFormFields
            values={formValues}
            onChange={setFormValues}
            patientId={patient.id}
            patientCode={patient.patientCode}
            photoUrl={patient.photoUrl}
            version={patient.version}
          />
        </div>

        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="button" loading={updateMutation.isPending} onClick={() => void save()}>
            Lưu
          </Button>
        </div>
      </div>
    </div>
  );
}
