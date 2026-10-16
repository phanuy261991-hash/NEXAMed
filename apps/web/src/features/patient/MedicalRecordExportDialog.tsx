import { useState } from 'react';
import { FilePdf } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { useExportPatientMedicalRecordMutation } from './patient.queries';

/**
 * "Xuất bệnh án PDF" (S6-06, ADM-05) — bắt buộc nhập "Lý do xuất" trước khi tải file, đúng khuôn
 * `CancelEncounterDialog.tsx`. Lý do gửi qua BODY (không phải query string) — xem
 * `patient.api.ts#exportPatientMedicalRecord()`/`.claude/docs/security-audit.md`.
 */
export function MedicalRecordExportDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useExportPatientMedicalRecordMutation(patientId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) return;
    try {
      await mutation.mutateAsync(reason);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không xuất được bệnh án, vui lòng thử lại.');
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <ConfirmDialog
        icon={FilePdf}
        title="Xuất bệnh án PDF"
        note="Gồm thông tin hành chính, tiền sử và mọi lượt khám đã hoàn tất của bệnh nhân."
        error={error}
        onClose={onClose}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!reason.trim()}>
              Xuất PDF
            </Button>
          </>
        }
      >
        <label htmlFor="export-medical-record-reason" className="mb-1 block text-sm font-semibold text-slate-800">
          Lý do xuất <span className="text-rose-500">*</span>
        </label>
        <textarea
          id="export-medical-record-reason"
          rows={2}
          required
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ví dụ: gửi hội chẩn chuyên khoa, theo yêu cầu bệnh nhân"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </ConfirmDialog>
    </form>
  );
}
