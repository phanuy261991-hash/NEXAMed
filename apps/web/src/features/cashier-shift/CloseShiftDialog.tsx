import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import type { CashierShiftDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { WizardStepper } from '../../shared/ui/WizardStepper';
import { useHasPermission } from '../auth/usePermission';
import { CashVoucherFormDialog, type CashVoucherSubmitDto } from '../cash-book/CashVoucherFormDialog';
import { useCreateCashVoucherMutation } from '../cash-book/cash-voucher.queries';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { CashierShiftReceiptView } from './CashierShiftReceiptView';
import { CloseShiftCountStep, CloseShiftHandoverStep, CloseShiftReconcileStep, CloseShiftRevenueStep } from './CloseShiftSteps';
import { useCashierShiftBlindCloseEnabledQuery, useCashierShiftSummaryQuery, useCloseCashierShiftMutation } from './cashier-shift.queries';

const STEP_LABELS = ['Tổng kết hệ thống', 'Kiểm đếm tiền mặt', 'Đối soát', 'Bàn giao'];

/** "Chốt ca" — wizard 4 bước, dùng số bước vì đây là luồng thật sự tuần tự (`.claude/docs/ui-guidelines.md` mục 8.2). */
export function CloseShiftDialog({ shift, onClose }: { shift: CashierShiftDetail; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [countedAmount, setCountedAmount] = useState(0);
  const [directEntry, setDirectEntry] = useState(false);
  const [discrepancyReason, setDiscrepancyReason] = useState('');
  const [keepAmount, setKeepAmount] = useState<number>(shift.openingFloatActual);
  const [handoverNote, setHandoverNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [closedShift, setClosedShift] = useState<CashierShiftDetail | null>(null);
  // "Sổ quỹ & Thu chi" GĐ1 — nút tắt lập phiếu thu/chi ngay trong bước đếm tiền (yêu cầu #5 mockup):
  // lập xong tự invalidate `cashier-shift` (xem cash-voucher.queries.ts) nên "Tiền mặt dự kiến" ở
  // Bước 1/3 cập nhật ngay, không cần đóng wizard rồi mở lại.
  const canCreateCashVoucher = useHasPermission('cash_voucher', 'create');
  const [cashVoucherModalOpen, setCashVoucherModalOpen] = useState(false);
  const createCashVoucherMutation = useCreateCashVoucherMutation();

  const blindQuery = useCashierShiftBlindCloseEnabledQuery();
  const summaryQuery = useCashierShiftSummaryQuery(shift.id);
  const clinicHeaderQuery = useClinicPrintHeaderQuery();
  const closeMutation = useCloseCashierShiftMutation(shift.id);

  async function handleCreateCashVoucher(dto: CashVoucherSubmitDto) {
    return createCashVoucherMutation.mutateAsync({
      direction: dto.direction!,
      incomeExpenseTypeCode: dto.incomeExpenseTypeCode,
      cashAccountId: dto.cashAccountId,
      paymentMethodCode: dto.paymentMethodCode,
      amount: dto.amount,
      occurredAt: dto.occurredAt,
      partnerName: dto.partnerName,
      description: dto.description,
      note: dto.note,
    });
  }

  const blind = blindQuery.data ?? true;
  const expected = summaryQuery.data?.expectedCashAmount ?? 0;
  const diff = countedAmount - expected;
  const submittedAmount = Math.max(countedAmount - keepAmount, 0);

  async function handleConfirm() {
    setError(null);
    try {
      const updated = await closeMutation.mutateAsync({
        countedCashAmount: countedAmount,
        cashDiscrepancyReason: diff !== 0 ? discrepancyReason : undefined,
        keepForNextAmount: keepAmount,
        handoverNote: handoverNote.trim() === '' ? undefined : handoverNote,
        version: shift.version,
      });
      setClosedShift(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không chốt được ca, vui lòng thử lại.');
    }
  }

  const canGoNext =
    (step === 2 && countedAmount > 0) || (step === 3 && (diff === 0 || discrepancyReason.trim() !== '')) || step === 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="close-shift-title">
      {/* max-w-2xl (672px) x1.2 ≈ 806px — dãn thêm 20% theo yêu cầu chủ dự án khi xem trên bản chạy thật (2026-09-05). */}
      <div className="flex max-h-[92vh] w-full max-w-[806px] flex-col rounded-xl bg-white shadow-xl">
        <div className="flex-shrink-0 border-b border-slate-100 px-6 pt-6 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 id="close-shift-title" className="text-lg font-bold text-slate-900">
                Chốt ca
              </h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {shift.shiftLabel} · {shift.cashierName} · Mở lúc {new Date(shift.openedAt).toLocaleString('vi-VN')}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Đóng">
              <X size={20} weight="bold" aria-hidden="true" />
            </button>
          </div>

          {!closedShift && <WizardStepper labels={STEP_LABELS} currentStep={step} />}
        </div>

        <div className="scroll-hover flex-1 overflow-y-auto px-6 py-5">
          {closedShift ? (
            <div>
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                Đã chốt ca thành công — dữ liệu đã khoá. Tài khoản vẫn đang đăng nhập bình thường.
              </div>
              {clinicHeaderQuery.data && <CashierShiftReceiptView shift={closedShift} clinicHeader={clinicHeaderQuery.data} onAfterPrint={onClose} />}
            </div>
          ) : (
            <>
              {step === 1 && (
                <div>
                  <p className="mb-4 text-sm font-medium text-slate-500">Hệ thống tự động tổng hợp mọi phiếu thu phát sinh trong ca — số liệu bên dưới không sửa được.</p>
                  <CloseShiftRevenueStep summary={summaryQuery.data} isPending={summaryQuery.isPending} blind={blind} openingFloatActual={shift.openingFloatActual} />
                </div>
              )}

              {step === 2 && (
                <CloseShiftCountStep
                  countedAmount={countedAmount}
                  onChangeCountedAmount={setCountedAmount}
                  directEntry={directEntry}
                  onToggleDirectEntry={() => setDirectEntry((v) => !v)}
                  canCreateCashVoucher={canCreateCashVoucher}
                  onOpenCashVoucherModal={() => setCashVoucherModalOpen(true)}
                />
              )}

              {step === 3 && (
                <CloseShiftReconcileStep
                  expected={expected}
                  countedAmount={countedAmount}
                  discrepancyReason={discrepancyReason}
                  onChangeDiscrepancyReason={setDiscrepancyReason}
                />
              )}

              {step === 4 && (
                <CloseShiftHandoverStep
                  keepAmount={keepAmount}
                  onChangeKeepAmount={setKeepAmount}
                  submittedAmount={submittedAmount}
                  handoverNote={handoverNote}
                  onChangeHandoverNote={setHandoverNote}
                  error={error}
                />
              )}
            </>
          )}
        </div>

        {!closedShift && (
          <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-100 px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)} className={step === 1 ? 'invisible' : ''}>
              Quay lại
            </Button>
            {step < 4 ? (
              <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canGoNext}>
                Tiếp tục
              </Button>
            ) : (
              <Button type="button" onClick={() => void handleConfirm()} loading={closeMutation.isPending}>
                Xác nhận chốt ca & in phiếu
              </Button>
            )}
          </div>
        )}
      </div>
      {cashVoucherModalOpen && (
        <CashVoucherFormDialog
          mode="create"
          submitting={createCashVoucherMutation.isPending}
          onCancel={() => setCashVoucherModalOpen(false)}
          onSubmit={handleCreateCashVoucher}
        />
      )}
    </div>
  );
}
