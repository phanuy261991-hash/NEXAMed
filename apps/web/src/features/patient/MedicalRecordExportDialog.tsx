import { useState } from 'react';
import { FilePdf, Printer } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { useExportEncounterMedicalRecordMutation } from '../medical-record/medical-record.queries';
import { useExportPatientMedicalRecordMutation } from './patient.queries';

/** Xuất/in hồ sơ MỘT lượt khám (#269) thay vì toàn bộ bệnh án: `mode` = in (mở PDF ở tab mới) hoặc tải về; `note` = dòng nói rõ bộ hồ sơ gồm những gì. */
export interface EncounterExportTarget {
  encounterId: string;
  mode: 'print' | 'download';
  note: string;
}

/**
 * "Xuất toàn bộ bệnh án" (S6-06, ADM-05) và "In bộ hồ sơ"/"Xuất PDF" một lượt khám (#269) — bắt buộc nhập "Lý do xuất" trước khi ra tệp, đúng khuôn
 * `CancelEncounterDialog.tsx`. Lý do gửi qua BODY (không phải query string) — xem `patient.api.ts#exportPatientMedicalRecord()`/`.claude/docs/security-audit.md`.
 */
export function MedicalRecordExportDialog({ patientId, encounter, onClose }: { patientId: string; encounter?: EncounterExportTarget; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const patientMutation = useExportPatientMedicalRecordMutation(patientId);
  const encounterMutation = useExportEncounterMedicalRecordMutation(encounter?.encounterId ?? '');
  const pending = patientMutation.isPending || encounterMutation.isPending;
  const printing = encounter?.mode === 'print';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) return;
    // Mở tab in NGAY trong thao tác bấm (trước khi chờ máy chủ) để trình duyệt không chặn như cửa sổ bật lên tự động.
    const printWindow = printing ? window.open('', '_blank') : null;
    try {
      if (encounter) {
        await encounterMutation.mutateAsync({ reason, target: printing ? { mode: 'print', printWindow } : { mode: 'download' } });
      } else {
        await patientMutation.mutateAsync(reason);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không xuất được hồ sơ bệnh án, vui lòng thử lại.');
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <ConfirmDialog
        icon={printing ? Printer : FilePdf}
        title={encounter ? (printing ? 'In bộ hồ sơ' : 'Xuất PDF hồ sơ bệnh án') : 'Xuất toàn bộ bệnh án'}
        note={encounter ? encounter.note : 'Gồm thông tin hành chính, tiền sử và mọi lượt khám đã hoàn tất của bệnh nhân.'}
        error={error}
        onClose={onClose}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" loading={pending} disabled={!reason.trim()}>
              {printing ? 'In' : 'Xuất PDF'}
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
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </ConfirmDialog>
    </form>
  );
}
