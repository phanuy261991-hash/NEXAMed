import { useState } from 'react';
import { CheckCircle, PencilSimple, Plus, Printer, Warning, X } from '@phosphor-icons/react';
import type { PrescriptionItem, PrescriptionResponse } from '@nexamed/shared';
import { useAuthStore } from '../auth/auth.store';
import { useClinicProfileQuery } from '../clinic/clinic.queries';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { DrugPicker } from './DrugPicker';
import { PrescriptionPrintView } from './PrescriptionPrintView';
import {
  useAmendPrescriptionMutation,
  usePrintPrescriptionMutation,
  useSavePrescriptionItemsMutation,
  useSignPrescriptionMutation,
} from './encounter.queries';

interface DraftLine {
  drugId: string;
  drugName: string;
  dose: string;
  frequency: string;
  durationDays: string;
  quantity: string;
  instruction: string;
}

function itemToDraft(item: PrescriptionItem): DraftLine {
  return {
    drugId: item.drugId,
    drugName: item.drugName,
    dose: item.dose,
    frequency: item.frequency,
    durationDays: String(item.durationDays),
    quantity: String(item.quantity),
    instruction: item.instruction ?? '',
  };
}

const WARNING_KIND_LABEL: Record<string, string> = {
  duplicate_active_ingredient: 'Trùng hoạt chất',
  allergy: 'Trùng dị nguyên đã biết của bệnh nhân',
};

/**
 * Kê đơn (Sprint 4, S4-01/02/04) — tab "Kê đơn thuốc" của màn hình khám. Đơn NHÁP (`signedAt=null`)
 * sửa tự do (thêm/xoá/đổi dòng thuốc, bấm "Lưu đơn nháp" để lưu — KHÔNG autosave từng phím như ghi
 * chú lâm sàng #066, vì đây là hành động rời rạc thêm/bớt dòng thuốc, không phải gõ văn bản dài).
 * Cảnh báo PRE-02/03 CHỈ đọc từ response server (`prescription.warnings`, tính trong
 * `packages/core`) — `apps/web` KHÔNG được import `@nexamed/core` (ESLint chặn, docs/DECISIONS.md
 * #073), nên không tự tính lại ở đây. Sau khi ký (`signedAt != null`) đơn bất biến (trigger C8) —
 * sửa = "Sửa đơn" (đính chính, tạo bản mới đã ký ngay, bắt buộc lý do).
 */
export function PrescriptionPanel({
  encounterId,
  prescription,
  hasPrimaryDiagnosis,
  isEditableEncounter,
  patientFullName,
  patientDob,
  patientGender,
}: {
  encounterId: string;
  prescription: PrescriptionResponse;
  /** .claude/docs/clinical-workflow.md: "Tạo được khi encounter IN_CONSULTATION và đã có chẩn đoán chính". */
  hasPrimaryDiagnosis: boolean;
  /** `canEditNow` của trang cha (IN_CONSULTATION, hoặc COMPLETED đang bấm "Chỉnh sửa thông tin"). */
  isEditableEncounter: boolean;
  patientFullName: string;
  patientDob: string;
  patientGender: string;
}) {
  const doctorName = useAuthStore((s) => s.user?.fullName) ?? '';
  const clinicQuery = useClinicProfileQuery();

  const saveMutation = useSavePrescriptionItemsMutation(encounterId);
  const signMutation = useSignPrescriptionMutation(encounterId);
  const printMutation = usePrintPrescriptionMutation(encounterId);
  const amendMutation = useAmendPrescriptionMutation(encounterId);

  const isSigned = prescription !== null && prescription.signedAt !== null;
  const canEdit = isEditableEncounter && !isSigned;

  const [draftLines, setDraftLines] = useState<DraftLine[]>(() => (prescription?.items ?? []).map(itemToDraft));
  const [draftKey, setDraftKey] = useState(prescription?.id ?? 'new');
  // Đơn đổi sang bản khác hẳn (vd sau "Sửa đơn" tạo id mới) — nạp lại draft từ server thay vì giữ
  // state cũ đã lỗi thời. Không dùng useEffect (tránh 1 nhịp render lệch) — so sánh ngay trong
  // render, đúng mẫu "derived state reset theo key" của React.
  const currentKey = prescription?.id ?? 'new';
  if (currentKey !== draftKey) {
    setDraftKey(currentKey);
    setDraftLines((prescription?.items ?? []).map(itemToDraft));
  }

  const [amendOpen, setAmendOpen] = useState(false);
  const [amendLines, setAmendLines] = useState<DraftLine[]>([]);
  const [amendReason, setAmendReason] = useState('');

  function persistDraft(lines: DraftLine[]) {
    setDraftLines(lines);
    saveMutation.mutate({
      items: lines.map((l) => ({
        drugId: l.drugId,
        dose: l.dose,
        frequency: l.frequency,
        durationDays: Math.max(1, Number(l.durationDays) || 1),
        quantity: Math.max(1, Number(l.quantity) || 1),
        instruction: l.instruction.trim() || undefined,
      })),
    });
  }

  function handleAddDrug(drug: { drugId: string; drugName: string }) {
    setDraftLines((prev) => [...prev, { drugId: drug.drugId, drugName: drug.drugName, dose: '', frequency: '', durationDays: '5', quantity: '1', instruction: '' }]);
  }

  function handleRemoveLine(drugId: string) {
    persistDraft(draftLines.filter((l) => l.drugId !== drugId));
  }

  function updateLine(drugId: string, patch: Partial<DraftLine>) {
    setDraftLines((prev) => prev.map((l) => (l.drugId === drugId ? { ...l, ...patch } : l)));
  }

  function handleSign() {
    if (!prescription) return;
    signMutation.mutate({ version: prescription.version });
  }

  async function handlePrint() {
    await printMutation.mutateAsync();
    setTimeout(() => window.print(), 100);
  }

  function openAmend() {
    setAmendLines((prescription?.items ?? []).map(itemToDraft));
    setAmendReason('');
    setAmendOpen(true);
  }

  function handleAmendSubmit() {
    if (!prescription || amendReason.trim() === '' || amendLines.length === 0) return;
    amendMutation.mutate(
      {
        amendmentReason: amendReason.trim(),
        version: prescription.version,
        items: amendLines.map((l) => ({
          drugId: l.drugId,
          dose: l.dose,
          frequency: l.frequency,
          durationDays: Math.max(1, Number(l.durationDays) || 1),
          quantity: Math.max(1, Number(l.quantity) || 1),
          instruction: l.instruction.trim() || undefined,
        })),
      },
      { onSuccess: () => setAmendOpen(false) },
    );
  }

  if (!hasPrimaryDiagnosis) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8">
        <EmptyState icon={Warning} title="Chưa thể kê đơn" description="Phải chọn chẩn đoán chính ở tab &quot;Khám &amp; Chẩn đoán&quot; trước khi kê đơn thuốc." />
      </div>
    );
  }

  const warnings = prescription?.warnings ?? [];
  const clinic = clinicQuery.data;

  return (
    <div className="flex flex-col gap-4">
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-rose-200 bg-rose-50 p-3">
          {warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-2 text-sm font-semibold text-rose-700">
              <Warning size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
              {WARNING_KIND_LABEL[w.kind] ?? w.kind}: <span className="font-normal">{w.label}</span> — {w.drugNames.join(', ')}
            </p>
          ))}
        </div>
      )}

      {isSigned ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
              <CheckCircle size={16} weight="fill" aria-hidden="true" />
              Đã ký lúc {prescription!.signedAt ? new Date(prescription!.signedAt).toLocaleString('vi-VN') : ''}
              {prescription!.amendmentReason && ' (bản đính chính)'}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={openAmend}>
                <PencilSimple size={15} weight="bold" aria-hidden="true" />
                Sửa đơn
              </Button>
              <Button type="button" onClick={() => void handlePrint()} loading={printMutation.isPending}>
                <Printer size={15} weight="bold" aria-hidden="true" />
                In đơn
              </Button>
            </div>
          </div>
          <PrescriptionItemsTable items={prescription!.items} />
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          {draftLines.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">Chưa có dòng thuốc nào — tìm và thêm thuốc bên dưới.</p>
          ) : (
            <div className="mb-4 flex flex-col gap-2">
              {draftLines.map((line) => (
                <div key={line.drugId} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-slate-200 p-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{line.drugName}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <LineInput label="Liều dùng" value={line.dose} onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.drugId === line.drugId ? { ...l, dose: v } : l)))} onChange={(v) => updateLine(line.drugId, { dose: v })} disabled={!canEdit} />
                      <LineInput label="Tần suất" value={line.frequency} onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.drugId === line.drugId ? { ...l, frequency: v } : l)))} onChange={(v) => updateLine(line.drugId, { frequency: v })} disabled={!canEdit} />
                      <LineInput label="Số ngày" type="number" value={line.durationDays} onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.drugId === line.drugId ? { ...l, durationDays: v } : l)))} onChange={(v) => updateLine(line.drugId, { durationDays: v })} disabled={!canEdit} />
                      <LineInput label="Số lượng" type="number" value={line.quantity} onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.drugId === line.drugId ? { ...l, quantity: v } : l)))} onChange={(v) => updateLine(line.drugId, { quantity: v })} disabled={!canEdit} />
                    </div>
                    <div className="mt-2">
                      <LineInput label="Hướng dẫn dùng" value={line.instruction} onBlurCommit={(v) => persistDraft(draftLines.map((l) => (l.drugId === line.drugId ? { ...l, instruction: v } : l)))} onChange={(v) => updateLine(line.drugId, { instruction: v })} disabled={!canEdit} />
                    </div>
                  </div>
                  {canEdit && (
                    <button type="button" onClick={() => handleRemoveLine(line.drugId)} className="h-fit text-slate-400 hover:text-rose-600" aria-label={`Xoá ${line.drugName}`}>
                      <X size={16} weight="bold" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <>
              <DrugPicker excludeDrugIds={draftLines.map((l) => l.drugId)} onSelect={(drug) => handleAddDrug(drug)} />
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => persistDraft(draftLines)} loading={saveMutation.isPending}>
                  <Plus size={15} weight="bold" aria-hidden="true" />
                  Lưu đơn nháp
                </Button>
                <Button type="button" onClick={handleSign} loading={signMutation.isPending} disabled={!prescription || prescription.items.length === 0}>
                  Ký đơn
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {isSigned && prescription && clinic && (
        <PrescriptionPrintView
          clinicName={clinic.name}
          clinicAddress={clinic.address}
          clinicPhone={clinic.phone}
          printLogoUrl={clinic.printLogoUrl}
          doctorName={doctorName}
          patientFullName={patientFullName}
          patientDob={patientDob}
          patientGender={patientGender}
          items={prescription.items}
          signedAt={prescription.signedAt!}
        />
      )}

      {amendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-[15px] font-semibold text-slate-900">Sửa đơn (đính chính)</h2>
            <p className="mt-1 text-xs text-slate-500">Tạo bản đơn mới thay thế đơn đã ký — bản cũ vẫn lưu lại trong lịch sử, không mất.</p>

            <div className="scroll-hover mt-3 flex-1 space-y-2 overflow-y-auto">
              {amendLines.map((line) => (
                <div key={line.drugId} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-900">{line.drugName}</p>
                    <button type="button" onClick={() => setAmendLines((prev) => prev.filter((l) => l.drugId !== line.drugId))} className="text-slate-400 hover:text-rose-600">
                      <X size={15} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <LineInput label="Liều dùng" value={line.dose} onChange={(v) => setAmendLines((prev) => prev.map((l) => (l.drugId === line.drugId ? { ...l, dose: v } : l)))} />
                    <LineInput label="Tần suất" value={line.frequency} onChange={(v) => setAmendLines((prev) => prev.map((l) => (l.drugId === line.drugId ? { ...l, frequency: v } : l)))} />
                    <LineInput label="Số ngày" type="number" value={line.durationDays} onChange={(v) => setAmendLines((prev) => prev.map((l) => (l.drugId === line.drugId ? { ...l, durationDays: v } : l)))} />
                    <LineInput label="Số lượng" type="number" value={line.quantity} onChange={(v) => setAmendLines((prev) => prev.map((l) => (l.drugId === line.drugId ? { ...l, quantity: v } : l)))} />
                  </div>
                </div>
              ))}
              <DrugPicker
                excludeDrugIds={amendLines.map((l) => l.drugId)}
                onSelect={(drug) => setAmendLines((prev) => [...prev, { drugId: drug.drugId, drugName: drug.drugName, dose: '', frequency: '', durationDays: '5', quantity: '1', instruction: '' }])}
              />
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              <label htmlFor="amend-reason" className="text-sm font-semibold text-slate-800">
                Lý do đính chính
              </label>
              <textarea
                id="amend-reason"
                rows={2}
                value={amendReason}
                onChange={(e) => setAmendReason(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAmendOpen(false)}>
                Huỷ
              </Button>
              <Button type="button" onClick={handleAmendSubmit} loading={amendMutation.isPending} disabled={amendReason.trim() === '' || amendLines.length === 0}>
                Lưu bản đính chính
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LineInput({
  label,
  value,
  onChange,
  onBlurCommit,
  type = 'text',
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlurCommit?: (v: string) => void;
  type?: 'text' | 'number';
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-600">
      {label}
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlurCommit?.(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
      />
    </label>
  );
}

function PrescriptionItemsTable({ items }: { items: PrescriptionItem[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
          <th className="py-2">Tên thuốc</th>
          <th className="py-2">Liều dùng</th>
          <th className="py-2">Tần suất</th>
          <th className="py-2 text-center">Số ngày</th>
          <th className="py-2 text-center">SL</th>
          <th className="py-2">Hướng dẫn</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-slate-100 last:border-0">
            <td className="py-2 font-semibold text-slate-900">{item.drugName}</td>
            <td className="py-2 text-slate-700">{item.dose}</td>
            <td className="py-2 text-slate-700">{item.frequency}</td>
            <td className="py-2 text-center text-slate-700">{item.durationDays}</td>
            <td className="py-2 text-center text-slate-700">{item.quantity}</td>
            <td className="py-2 text-slate-700">{item.instruction ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
