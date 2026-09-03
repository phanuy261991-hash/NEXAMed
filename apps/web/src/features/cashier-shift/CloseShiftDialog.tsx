import { useState } from 'react';
import { Bank, CreditCard, X } from '@phosphor-icons/react';
import type { CashierShiftDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { DenominationCounter } from '../../shared/ui/DenominationCounter';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { CashierShiftReceiptView } from './CashierShiftReceiptView';
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

  const blindQuery = useCashierShiftBlindCloseEnabledQuery();
  const summaryQuery = useCashierShiftSummaryQuery(shift.id);
  const clinicHeaderQuery = useClinicPrintHeaderQuery();
  const closeMutation = useCloseCashierShiftMutation(shift.id);

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
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
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

          {!closedShift && (
            <>
              <div className="mt-5 flex items-center gap-1.5">
                {[1, 2, 3, 4].map((s, i) => (
                  <div key={s} className={`flex items-center gap-1.5 ${i < 3 ? 'flex-1' : ''}`}>
                    <div
                      className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        s < step ? 'bg-blue-600 text-white' : s === step ? 'bg-blue-600 text-white ring-4 ring-blue-100' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {s}
                    </div>
                    {i < 3 && <div className={`h-0.5 flex-1 ${s < step ? 'bg-blue-600' : 'bg-slate-200'}`} />}
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex text-[11px] font-semibold text-slate-500">
                {STEP_LABELS.map((label, i) => (
                  <span key={label} className={i < 3 ? 'flex-1' : ''}>
                    {label}
                  </span>
                ))}
              </div>
            </>
          )}
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
                  {summaryQuery.isPending ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <SummaryCard label="Vốn đầu ca" value={formatVnd(shift.openingFloatActual)} />
                        <SummaryCard label={`Tổng thu tiền mặt (${summaryQuery.data?.cashInCount ?? 0} phiếu)`} value={`+${formatVnd(summaryQuery.data?.cashInAmount ?? 0)}`} valueClassName="text-emerald-600" />
                        <SummaryCard label={`Chi tiền mặt — hoàn tiền (${summaryQuery.data?.cashOutCount ?? 0} phiếu)`} value={`−${formatVnd(summaryQuery.data?.cashOutAmount ?? 0)}`} valueClassName="text-rose-600" />
                        <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
                          <div className="text-[11px] font-bold uppercase tracking-wide text-blue-500">Tiền mặt dự kiến trong két</div>
                          {blind ? (
                            <div className="mt-1 flex items-baseline gap-1.5">
                              <span className="text-xl font-bold tracking-widest text-blue-300">*.***.***</span>
                              <span className="text-xs font-semibold text-blue-300">đ — hiện sau khi đếm</span>
                            </div>
                          ) : (
                            <div className="mt-1 text-xl font-bold text-blue-700">{formatVnd(expected)}</div>
                          )}
                        </div>
                      </div>

                      {(summaryQuery.data?.nonCashBreakdown.length ?? 0) > 0 && (
                        <>
                          <div className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Phi tiền mặt — đối chiếu qua sao kê, không cần đếm tay</div>
                          <div className="grid grid-cols-2 gap-3">
                            {summaryQuery.data!.nonCashBreakdown.map((item) => (
                              <div key={item.method} className="flex items-center gap-3 rounded-lg border border-slate-200 p-4">
                                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                                  {item.method === 'BANK_TRANSFER' ? <Bank size={18} weight="regular" aria-hidden="true" /> : <CreditCard size={18} weight="regular" aria-hidden="true" />}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-slate-500">
                                    {item.methodLabel} · {item.count} giao dịch
                                  </div>
                                  <div className="text-lg font-bold text-slate-900">{formatVnd(item.amount)}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {step === 2 && (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-500">Đếm từng mệnh giá — hệ thống tự cộng tổng.</p>
                    <button type="button" onClick={() => setDirectEntry((v) => !v)} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                      {directEntry ? 'Dùng máy tính mệnh giá' : 'Nhập trực tiếp tổng số tiền'}
                    </button>
                  </div>
                  {directEntry ? (
                    <div>
                      <label htmlFor="direct-total" className="mb-1.5 block text-sm font-semibold text-slate-800">
                        Tổng tiền mặt đếm được <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <MoneyInput
                          id="direct-total"
                          value={countedAmount}
                          onChange={(v) => setCountedAmount(v ?? 0)}
                          className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">đ</span>
                      </div>
                    </div>
                  ) : (
                    <DenominationCounter value={countedAmount} onChange={setCountedAmount} />
                  )}
                </div>
              )}

              {step === 3 && (
                <div>
                  <div className="mb-4 grid grid-cols-3 gap-3">
                    <SummaryCard label="Dự kiến" value={formatVnd(expected)} center />
                    <SummaryCard label="Thực đếm" value={formatVnd(countedAmount)} center />
                    <div className={`rounded-lg border-2 p-4 text-center ${diff === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
                      <div className={`text-[11px] font-bold uppercase tracking-wide ${diff === 0 ? 'text-emerald-600' : 'text-rose-500'}`}>Chênh lệch</div>
                      <div className={`mt-1 text-lg font-bold ${diff === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {diff === 0 ? '0 đ' : `${diff > 0 ? '+' : '−'}${formatVnd(Math.abs(diff))}`}
                      </div>
                    </div>
                  </div>

                  {diff === 0 ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                      Khớp tuyệt đối — không cần giải trình, có thể tiếp tục.
                    </div>
                  ) : (
                    <div>
                      <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">Có chênh lệch — bắt buộc giải trình trước khi tiếp tục.</div>
                      <label htmlFor="diff-reason" className="mb-1.5 block text-sm font-semibold text-slate-800">
                        Lý do chênh lệch <span className="text-rose-500">*</span>
                      </label>
                      <textarea
                        id="diff-reason"
                        rows={3}
                        required
                        value={discrepancyReason}
                        onChange={(e) => setDiscrepancyReason(e.target.value)}
                        placeholder="Ví dụ: trả nhầm tiền thừa cho khách lúc 10:20, khách chuyển khoản nhưng quên ghi nhận..."
                        className="w-full rounded-md border border-rose-300 bg-white px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                  )}
                </div>
              )}

              {step === 4 && (
                <div>
                  <label htmlFor="handover-keep" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Tiền mặt để lại làm vốn cho ca sau
                  </label>
                  <div className="relative">
                    <MoneyInput
                      id="handover-keep"
                      value={keepAmount}
                      onChange={(v) => setKeepAmount(v ?? 0)}
                      className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">đ</span>
                  </div>

                  <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 p-4">
                    <span className="text-sm font-semibold text-slate-700">Tiền mặt nộp về (chủ phòng khám / kế toán)</span>
                    <span className="text-xl font-bold text-blue-700">{formatVnd(submittedAmount)}</span>
                  </div>

                  <div className="mt-4">
                    <label htmlFor="handover-note" className="mb-1.5 block text-sm font-semibold text-slate-800">
                      Ghi chú bàn giao <span className="font-normal normal-case text-slate-400">(tuỳ chọn)</span>
                    </label>
                    <textarea
                      id="handover-note"
                      rows={2}
                      value={handoverNote}
                      onChange={(e) => setHandoverNote(e.target.value)}
                      placeholder="Ví dụ: đã kiểm tra cùng Quản lý ca, tiền đã cất vào két sắt văn phòng."
                      className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  <div className="mt-4 flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-xs font-medium text-amber-800">
                      Sau khi xác nhận, dữ liệu ca này bị khoá hoàn toàn — bạn không tự sửa lại được. Muốn sửa/huỷ phải có tài khoản Quản lý duyệt mở khoá.
                    </p>
                  </div>

                  {error && <p className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
                </div>
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
    </div>
  );
}

function SummaryCard({ label, value, valueClassName, center }: { label: string; value: string; valueClassName?: string; center?: boolean }) {
  return (
    <div className={`rounded-lg border border-slate-200 p-4 ${center ? 'text-center' : ''}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold text-slate-900 ${valueClassName ?? ''}`}>{value}</div>
    </div>
  );
}
