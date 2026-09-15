import { useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="export-medical-record-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p id="export-medical-record-title" className="text-sm font-semibold text-slate-900">
            Xuất bệnh án PDF
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Tệp PDF sẽ gồm thông tin hành chính, tiền sử và toàn bộ lượt khám đã hoàn tất của bệnh nhân này.
          </p>

          <div className="mt-3.5">
            <label htmlFor="export-medical-record-reason" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do xuất <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="export-medical-record-reason"
              rows={2}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: gửi hội chẩn chuyên khoa, theo yêu cầu bệnh nhân"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!reason.trim()}>
              Xuất PDF
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
