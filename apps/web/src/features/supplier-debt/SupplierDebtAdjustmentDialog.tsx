import { useMemo, useState } from 'react';
import { ClipboardText } from '@phosphor-icons/react';
import type { ComboboxOption } from '../../shared/ui/Combobox';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { TwoOptionToggle } from '../../shared/ui/TwoOptionToggle';
import { useHasPermission } from '../auth/usePermission';
import { useStockIssuesQuery, useStockReceiptsQuery } from '../inventory/inventory.queries';
import { useCreateSupplierDebtAdjustmentMutation, useApproveSupplierDebtAdjustmentMutation, useSupplierDebtPaymentsQuery } from './supplier-debt.queries';

const KIND_OPTIONS = [
  { value: 'INCREASE', label: 'Tăng nợ' },
  { value: 'DECREASE', label: 'Giảm nợ' },
] as const;

function parseTarget(v: string): { targetReceiptId?: string; targetIssueId?: string; targetVoucherId?: string } {
  if (v.startsWith('receipt:')) return { targetReceiptId: v.slice('receipt:'.length) };
  if (v.startsWith('issue:')) return { targetIssueId: v.slice('issue:'.length) };
  if (v.startsWith('voucher:')) return { targetVoucherId: v.slice('voucher:'.length) };
  return {};
}

/**
 * "Lập phiếu điều chỉnh công nợ" (Tăng/Giảm, Phần D — docs/DECISIONS.md #180/#182/#187) — KHÔNG đụng
 * tồn kho, khác "Đề nghị huỷ" (VOID_REQUEST, dùng lại `ReasonConfirmDialog` trực tiếp từ phiếu nhập/
 * xuất gốc — chỉ cần lý do, không cần số tiền/chứng từ liên quan tuỳ chọn như ở đây).
 */
export function SupplierDebtAdjustmentDialog({ supplierId, supplierName, onClose }: { supplierId: string; supplierName: string; onClose: () => void }) {
  const canApprove = useHasPermission('supplier_debt', 'approve');
  const [kind, setKind] = useState<'INCREASE' | 'DECREASE' | null>(null);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [targetValue, setTargetValue] = useState('');
  const [reason, setReason] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateSupplierDebtAdjustmentMutation();
  const approveMutation = useApproveSupplierDebtAdjustmentMutation();

  const receiptsQuery = useStockReceiptsQuery({ supplierId, limit: 100 });
  const issuesQuery = useStockIssuesQuery({ supplierId, issueType: 'RETURN_TO_SUPPLIER', limit: 100 });
  const paymentsQuery = useSupplierDebtPaymentsQuery({ supplierId });

  const targetOptions: ComboboxOption[] = useMemo(
    () => [
      ...(receiptsQuery.data?.items ?? []).map((r) => ({ value: `receipt:${r.id}`, label: `Phiếu nhập: ${r.receiptNo}` })),
      ...(issuesQuery.data?.items ?? []).map((i) => ({ value: `issue:${i.id}`, label: `Phiếu trả hàng: ${i.issueNo}` })),
      ...(paymentsQuery.data?.items ?? []).map((p) => ({ value: `voucher:${p.id}`, label: `Phiếu chi: ${p.voucherNo}` })),
    ],
    [receiptsQuery.data, issuesQuery.data, paymentsQuery.data],
  );

  const isInvalid = !kind || !amount || amount <= 0 || reason.trim() === '';
  const saving = createMutation.isPending || approveMutation.isPending;

  async function handleSave(andApprove: boolean) {
    if (isInvalid || !kind || !amount) return;
    setError(null);
    try {
      const created = await createMutation.mutateAsync({
        supplierId,
        kind,
        amount,
        ...parseTarget(targetValue),
        reason: reason.trim(),
        evidenceRef: evidenceRef.trim() || undefined,
      });
      if (andApprove) {
        await approveMutation.mutateAsync({ id: created.id, body: { version: created.version } });
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex-shrink-0 px-6 pt-6">
          <ModalHeader icon={ClipboardText} title="Lập phiếu điều chỉnh công nợ" subtitle={supplierName} onClose={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          {error && <ErrorBanner message={error} />}
          <div className="my-4 flex flex-col gap-4">
            <BoxedSection badge="Điều chỉnh">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold text-slate-800">
                    Loại <span className="text-rose-500">*</span>
                  </label>
                  <TwoOptionToggle options={KIND_OPTIONS} value={kind} onChange={setKind} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="adj-amount" className="text-sm font-semibold text-slate-800">
                    Số tiền <span className="text-rose-500">*</span>
                  </label>
                  <MoneyInput
                    id="adj-amount"
                    value={amount}
                    onChange={setAmount}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="adj-target" className="text-sm font-semibold text-slate-800">
                    Phiếu nhập/Phiếu xuất/Phiếu chi liên quan
                  </label>
                  <Combobox id="adj-target" value={targetValue} onChange={setTargetValue} placeholder="— Không chọn —" options={targetOptions} />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="adj-reason" className="text-sm font-semibold text-slate-800">
                    Lý do <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    id="adj-reason"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="adj-evidence" className="text-sm font-semibold text-slate-800">
                    Số biên bản
                  </label>
                  <input
                    id="adj-evidence"
                    type="text"
                    value={evidenceRef}
                    onChange={(e) => setEvidenceRef(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            </BoxedSection>
          </div>
        </div>
        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button type="button" variant="secondary" loading={saving} disabled={isInvalid} onClick={() => void handleSave(false)}>
            Lưu &amp; chuyển duyệt
          </Button>
          {canApprove && (
            <Button type="button" loading={saving} disabled={isInvalid} onClick={() => void handleSave(true)}>
              Lưu &amp; Duyệt ngay
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
