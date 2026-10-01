import { useState } from 'react';
import { UserCircle } from '@phosphor-icons/react';
import type { PatientDetail } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { RecordFormNotice } from '../../shared/ui/RecordFormNotice';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';
import { useStaleRecordWatch } from '../../shared/hooks/useStaleRecordWatch';
import { PatientFormFields, type PatientFormValues } from './PatientFormFields';
import { patientDetailToFormValues, toUpdatePatientRequest } from './patient-form.utils';
import { usePatientQuery, useUpdatePatientMutation } from './patient.queries';

/**
 * "Sửa hồ sơ" — dialog riêng (đổi từ sửa-tại-chỗ cũ của `PatientDetailPage.tsx`, đã hỏi và chốt lúc
 * duyệt mockup trang "Hồ sơ bệnh nhân"). Logic lưu/optimistic-lock RELOCATE nguyên vẹn từ bản cũ,
 * không viết lại — chỉ đổi nơi hiển thị.
 */
export function PatientEditDialog({ patient, onClose }: { patient: PatientDetail; onClose: () => void }) {
  const updateMutation = useUpdatePatientMutation(patient.id);
  const patientQuery = usePatientQuery(patient.id);
  const [formValues, setFormValues] = useState<PatientFormValues>(() => patientDetailToFormValues(patient));
  // Phiên bản hồ sơ lúc form này được mở/tải lại — bản trên server mới hơn nghĩa là người khác vừa lưu.
  const [baseVersion, setBaseVersion] = useState(patient.version);
  const { saveError, run } = useSaveAttempt();
  const stale = useStaleRecordWatch({
    enabled: true,
    currentVersion: baseVersion,
    latestVersion: patientQuery.data?.version ?? patient.version,
    refetch: patientQuery.refetch,
  });

  async function save() {
    if (stale) return;
    if (await run(() => updateMutation.mutateAsync(toUpdatePatientRequest(formValues, baseVersion)))) onClose();
  }

  /** Tải bản mới nhất từ server và nạp lại form (mất các chỉnh sửa chưa lưu — đúng như thông báo cho người dùng). */
  async function reload() {
    const fresh = (await patientQuery.refetch()).data;
    if (!fresh) return;
    setFormValues(patientDetailToFormValues(fresh));
    setBaseVersion(fresh.version);
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
          <RecordFormNotice stale={stale} saveError={saveError} onReload={reload} />
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
          <Button type="button" loading={updateMutation.isPending} disabled={stale} onClick={() => void save()}>
            Lưu
          </Button>
        </div>
      </div>
    </div>
  );
}
