import { useState } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Textarea } from '../../shared/ui/Textarea';
import { TreatmentPlanPanel } from './TreatmentPlanPanel';
import { sameTreatmentPlan, treatmentPlanError, type TreatmentPlanDraft } from './treatment-plan';

export interface TreatmentAmendValues {
  plan: TreatmentPlanDraft;
  content: string;
  advice: string;
}

/**
 * "Đính chính điều trị" (docs/DECISIONS.md #222) — lượt khám đã ký không sửa tại chỗ được, sửa qua hộp thoại này kèm lý do bắt buộc (đúng khuôn "Đính chính ghi chú khám"/"Đính chính chẩn đoán").
 * Dùng lại nguyên `TreatmentPlanPanel` để cách nhập y hệt lúc đang khám. Chỉ phần THỰC SỰ đổi mới được gửi lên (nơi gọi so sánh), phần không đổi giữ nguyên bản đã ký.
 */
export function TreatmentAmendDialog({
  initial,
  examDate,
  submitting,
  onSubmit,
  onClose,
}: {
  initial: TreatmentAmendValues;
  examDate: string;
  submitting: boolean;
  onSubmit: (values: TreatmentAmendValues, reason: string) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<TreatmentAmendValues>(initial);
  const [reason, setReason] = useState('');

  const changed = values.content !== initial.content || values.advice !== initial.advice || !sameTreatmentPlan(values.plan, initial.plan);
  const planError = treatmentPlanError(values.plan, examDate);
  const canSubmit = reason.trim() !== '' && changed && planError === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Đính chính điều trị">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit(values, reason.trim());
        }}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg bg-white p-5 shadow-xl"
      >
        <ModalHeader icon={PencilSimple} title="Đính chính điều trị" subtitle="Bản cũ được giữ lại để truy vết" onClose={onClose} />
        <div className="scroll-hover min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <TreatmentPlanPanel
            idPrefix="amend"
            plan={values.plan}
            onPlanChange={(plan) => setValues((v) => ({ ...v, plan }))}
            content={values.content}
            onContentChange={(content) => setValues((v) => ({ ...v, content }))}
            advice={values.advice}
            onAdviceChange={(advice) => setValues((v) => ({ ...v, advice }))}
            examDate={examDate}
            readOnly={false}
          />
          <Textarea id="treatment-amend-reason" label="Lý do đính chính" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting} disabled={!canSubmit}>
            Lưu bản đính chính
          </Button>
        </div>
      </form>
    </div>
  );
}
