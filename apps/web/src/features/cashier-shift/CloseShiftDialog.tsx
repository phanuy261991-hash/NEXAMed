import { useState } from 'react';
import { CheckCircle, Printer, X } from '@phosphor-icons/react';
import type { CashierShiftDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { WizardStepper } from '../../shared/ui/WizardStepper';
import { useHasPermission } from '../auth/usePermission';
import { CashVoucherFormDialog, type CashVoucherSubmitDto } from '../cash-book/CashVoucherFormDialog';
import { useCreateCashVoucherMutation } from '../cash-book/cash-voucher.queries';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { CashierShiftReceiptView, computeCashierShiftDiff, computeCashierShiftTotalRevenue, formatDateTimeVn } from './CashierShiftReceiptView';
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
  const [receiptOpen, setReceiptOpen] = useState(false);
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
  const shiftDiff = closedShift ? computeCashierShiftDiff(closedShift) : 0;

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
              <div className="flex items-center gap-2.5">
                <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <CheckCircle size={13} weight="bold" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[13.5px] font-bold text-emerald-700">Đã chốt ca thành công</p>
                  <p className="text-[11.5px] font-medium text-slate-500">Dữ liệu đã khoá — đối chiếu số liệu bên dưới trước khi bàn giao.</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-[210px_1fr] items-start gap-6">
                <div className="flex flex-col gap-3.5">
                  <div className="rounded-lg bg-brand-teal-panel p-4">
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-brand-teal-active">Tổng doanh thu ca</p>
                    <p className="mt-0.5 text-[26px] font-bold tabular-nums text-slate-900">{formatVnd(computeCashierShiftTotalRevenue(closedShift))}</p>
                  </div>
                  <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
                    <ShiftMetaRow label="Ca" value={closedShift.shiftLabel} />
                    <ShiftMetaRow label="Thu ngân" value={closedShift.cashierName} />
                    <ShiftMetaRow label="Mở ca" value={formatDateTimeVn(closedShift.openedAt)} />
                    <ShiftMetaRow label="Chốt ca" value={closedShift.closedAt ? formatDateTimeVn(closedShift.closedAt) : '—'} />
                  </div>
                </div>

                <div className="flex flex-col gap-2.5">
                  <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-slate-200">
                    <ShiftSummaryCell label="Vốn đầu ca" value={formatVnd(closedShift.openingFloatActual)} className="border-b border-r border-slate-200" />
                    <ShiftSummaryCell label="Thu tiền mặt" value={formatVnd(closedShift.cashInAmount ?? 0)} className="border-b border-r border-slate-200" />
                    <ShiftSummaryCell
                      label="Hoàn tiền mặt"
                      value={`−${formatVnd(closedShift.cashOutAmount ?? 0)}`}
                      negative={(closedShift.cashOutAmount ?? 0) > 0}
                      className="border-b border-slate-200"
                    />
                    <ShiftSummaryCell label="Thực đếm" value={formatVnd(closedShift.countedCashAmount ?? 0)} className="border-r border-slate-200" />
                    <ShiftSummaryCell
                      label="Chênh lệch"
                      value={shiftDiff === 0 ? formatVnd(0) : `${shiftDiff > 0 ? '+' : '−'}${formatVnd(Math.abs(shiftDiff))}`}
                      negative={shiftDiff !== 0}
                      className="border-r border-slate-200"
                    />
                    <ShiftSummaryCell label="Để lại vốn ca sau" value={formatVnd(closedShift.keepForNextAmount ?? 0)} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-brand-teal-tint px-4 py-3">
                    <span className="text-[13px] font-bold text-slate-900">Nộp về</span>
                    <span className="text-[18px] font-bold tabular-nums text-blue-700">{formatVnd(closedShift.submittedAmount ?? 0)}</span>
                  </div>
                </div>
              </div>
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

        {closedShift && (
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => setReceiptOpen(true)} className="inline-flex items-center gap-1.5">
              <Printer size={16} weight="regular" aria-hidden="true" />
              In phiếu
            </Button>
            <Button type="button" onClick={onClose}>
              Đóng
            </Button>
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

      {receiptOpen && closedShift && clinicHeaderQuery.data && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="close-shift-receipt-title">
          <div className="flex max-h-[92vh] w-full max-w-[620px] flex-col rounded-xl bg-white shadow-xl">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-6 pt-6 pb-4">
              <h2 id="close-shift-receipt-title" className="text-lg font-bold text-slate-900">
                Phiếu bàn giao ca
              </h2>
              <button type="button" onClick={() => setReceiptOpen(false)} className="text-slate-400 hover:text-slate-700" aria-label="Đóng">
                <X size={20} weight="bold" aria-hidden="true" />
              </button>
            </div>
            <div className="scroll-hover flex-1 overflow-y-auto px-6 py-5">
              <CashierShiftReceiptView shift={closedShift} clinicHeader={clinicHeaderQuery.data} onAfterPrint={onClose} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Cặp nhãn/giá trị "danh tính" ca (Ca/Thu ngân/Mở ca/Chốt ca) trong "bảng tóm tắt Chốt ca". */
function ShiftMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="whitespace-nowrap text-[10.5px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="truncate text-[12.5px] font-semibold text-slate-900">{value}</span>
    </div>
  );
}

/** Ô lưới 3×2 chi tiết tiền trong "bảng tóm tắt Chốt ca". */
function ShiftSummaryCell({ label, value, negative = false, className = '' }: { label: string; value: string; negative?: boolean; className?: string }) {
  return (
    <div className={`p-3 ${className}`}>
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-[14.5px] font-bold tabular-nums ${negative ? 'text-rose-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
