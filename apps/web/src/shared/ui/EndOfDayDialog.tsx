import { useEffect, useState } from 'react';
import { CalendarBlank, CheckCircle, Warning, X } from '@phosphor-icons/react';
import type { CashierShiftDetail } from '@nexamed/shared';
import { getVietnamTodayDateString } from '../../features/appointment/schedule-grid.utils';
import { useReceptionListQuery } from '../../features/reception/reception.queries';
import { useClinicPrintHeaderQuery, useDoctorShiftSummaryQuery, useSetDoctorAvailabilityMutation } from '../../features/clinic/clinic.queries';
import { useHasPermission } from '../../features/auth/usePermission';
import {
  useApproveCashierShiftMutation,
  useCashierShiftBlindCloseEnabledQuery,
  useCashierShiftSummaryQuery,
  useCloseCashierShiftMutation,
  useCurrentCashierShiftQuery,
} from '../../features/cashier-shift/cashier-shift.queries';
import { CashierShiftReceiptView } from '../../features/cashier-shift/CashierShiftReceiptView';
import { CloseShiftCountStep, CloseShiftHandoverStep, CloseShiftReconcileStep, CloseShiftRevenueStep } from '../../features/cashier-shift/CloseShiftSteps';
import { OpenShiftDialog } from '../../features/cashier-shift/OpenShiftDialog';
import { ApiError } from '../api/client';
import { formatVnd } from '../format/currency';
import { Button } from './Button';
import { DoctorShiftSummaryPanel, formatTodayChipLabel } from './DoctorEndShiftDialog';
import { Skeleton } from './Skeleton';
import { WizardStepper } from './WizardStepper';

const STEP_LABELS = ['Tổng kết ngày', 'Kiểm đếm tiền mặt', 'Đối soát', 'Hoàn tất'];

/**
 * "Kết thúc ngày làm việc" — "Chế độ phòng khám 1 người" (mockup Artifact đã duyệt, 2026-09-14,
 * `docs/DECISIONS.md` #138). Thay `DoctorEndShiftDialog.tsx` khi `ClinicSettings.soloClinicWorkflowEnabled`
 * bật (`TopBar.tsx` chọn dialog nào theo đúng công tắc, KHÔNG thêm lối vào mới — vẫn cùng nút
 * "Đóng ca hôm nay"/nhắc tự động hết giờ làm việc). Gộp Đóng ca khám (`DoctorShiftSummaryPanel` +
 * lý do, tái dùng từ `DoctorEndShiftDialog.tsx`) với Chốt ca thu ngân (4 bước, tái dùng nguyên
 * `CloseShiftSteps.tsx` của `CloseShiftDialog.tsx`) thành 1 wizard 4 bước duy nhất — xác nhận ở
 * bước cuối chạy tuần tự: đóng ca khám → chốt ca thu ngân → tự động Duyệt (nếu actor có sẵn
 * `cashier_shift.manage`, không thì phiếu vẫn về "Chờ duyệt" như bình thường).
 *
 * Yêu cầu có SẴN 1 ca thu ngân đang mở (chỉ phòng khám 1 người BẬT được công tắc này — cùng 1
 * người mở ca của chính mình) — chưa có thì hiện màn nhắc "Mở ca ngay"/"Để sau" thay vì tự chốt hộ
 * (chốt qua `AskUserQuestion` trước khi code: báo lỗi/nhắc, không âm thầm bỏ qua bước thu ngân).
 */
export function EndOfDayDialog({
  doctorId,
  trigger,
  onDone,
  onClose,
}: {
  doctorId: string;
  trigger?: 'SCHEDULED_END';
  onDone: () => void;
  onClose: () => void;
}) {
  const isScheduled = trigger === 'SCHEDULED_END';
  const today = getVietnamTodayDateString();

  const currentShiftQuery = useCurrentCashierShiftQuery();
  const fetchedOpenShift = currentShiftQuery.data?.openShift ?? null;
  const [openShiftDialogOpen, setOpenShiftDialogOpen] = useState(false);
  // Khoá lại ca đã bắt được lần đầu — `closeCashierShift` (Bước 4) tự invalidate query này lúc
  // thành công, refetch trả `openShift: null` (ca vừa đóng), nếu dùng thẳng giá trị query sống thì
  // `EndOfDayWizard` bị unmount ngay giữa chừng, mất luôn màn thành công (`closedShift`) đang hiện
  // dở — bug thật phát hiện lúc verify Playwright (docs/DECISIONS.md #138).
  const [lockedShift, setLockedShift] = useState<CashierShiftDetail | null>(null);

  useEffect(() => {
    if (fetchedOpenShift && !lockedShift) {
      setLockedShift(fetchedOpenShift);
    }
  }, [fetchedOpenShift, lockedShift]);

  if (currentShiftQuery.isPending) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Đang tải">
        <div className="w-full max-w-[520px] rounded-xl bg-white p-8 shadow-md ring-1 ring-slate-200">
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (!lockedShift) {
    return (
      <>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="eod-noshift-title">
          <div className="w-full max-w-[460px] rounded-xl bg-white p-7 text-center shadow-md ring-1 ring-slate-200">
            <div className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <Warning size={24} weight="fill" aria-hidden="true" />
            </div>
            <h2 id="eod-noshift-title" className="mt-4 text-[17px] font-bold text-slate-900">
              Chưa có ca thu ngân đang mở
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
              &quot;Chế độ phòng khám 1 người&quot; gộp Đóng ca khám cùng Chốt ca thu ngân trong 1 lần xác nhận — cần mở ca thu ngân trước khi tiếp tục.
            </p>
            <div className="mt-5 flex justify-center gap-2.5">
              <Button type="button" variant="secondary" onClick={onClose}>
                Để sau
              </Button>
              <Button type="button" onClick={() => setOpenShiftDialogOpen(true)}>
                Mở ca ngay
              </Button>
            </div>
          </div>
        </div>
        {openShiftDialogOpen && <OpenShiftDialog previousClosedShift={currentShiftQuery.data?.previousClosedShift ?? null} onCancel={() => setOpenShiftDialogOpen(false)} onSuccess={() => setOpenShiftDialogOpen(false)} />}
      </>
    );
  }

  return <EndOfDayWizard doctorId={doctorId} trigger={trigger} isScheduled={isScheduled} today={today} openShift={lockedShift} onDone={onDone} onClose={onClose} />;
}

function EndOfDayWizard({
  doctorId,
  trigger,
  isScheduled,
  today,
  openShift,
  onDone,
  onClose,
}: {
  doctorId: string;
  trigger?: 'SCHEDULED_END';
  isScheduled: boolean;
  today: string;
  openShift: CashierShiftDetail;
  onDone: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState(isScheduled ? 'Hết giờ làm việc' : '');
  const [countedAmount, setCountedAmount] = useState(0);
  const [directEntry, setDirectEntry] = useState(false);
  const [discrepancyReason, setDiscrepancyReason] = useState('');
  const [keepAmount, setKeepAmount] = useState<number>(openShift.openingFloatActual);
  const [handoverNote, setHandoverNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'doctorEnded' | 'shiftClosed'>('idle');
  const [closedShift, setClosedShift] = useState<CashierShiftDetail | null>(null);

  const listQuery = useReceptionListQuery(today, doctorId, false, false);
  const pendingCount = (listQuery.data?.items ?? []).filter((i) => i.status === 'CHECKED_IN' || i.status === 'IN_CONSULTATION').length;

  const canApprove = useHasPermission('cashier_shift', 'manage');

  const blindQuery = useCashierShiftBlindCloseEnabledQuery();
  const summaryQuery = useCashierShiftSummaryQuery(openShift.id);
  const doctorSummaryQuery = useDoctorShiftSummaryQuery(doctorId);
  const clinicHeaderQuery = useClinicPrintHeaderQuery();

  const setAvailability = useSetDoctorAvailabilityMutation();
  const closeMutation = useCloseCashierShiftMutation(openShift.id);
  const approveMutation = useApproveCashierShiftMutation(openShift.id);

  const blind = blindQuery.data ?? true;
  const expected = summaryQuery.data?.expectedCashAmount ?? 0;
  const diff = countedAmount - expected;
  const submittedAmount = Math.max(countedAmount - keepAmount, 0);
  const canGoNext = (step === 2 && countedAmount > 0) || (step === 3 && (diff === 0 || discrepancyReason.trim() !== '')) || step === 1;

  async function handleConfirm() {
    setError(null);
    try {
      if (phase === 'idle') {
        await setAvailability.mutateAsync({ doctorId, body: { status: 'ENDED', reason: reason.trim() || undefined, trigger } });
        setPhase('doctorEnded');
      }
      let shift = closedShift;
      if (phase !== 'shiftClosed') {
        shift = await closeMutation.mutateAsync({
          countedCashAmount: countedAmount,
          cashDiscrepancyReason: diff !== 0 ? discrepancyReason : undefined,
          keepForNextAmount: keepAmount,
          handoverNote: handoverNote.trim() === '' ? undefined : handoverNote,
          version: openShift.version,
        });
        setClosedShift(shift);
        setPhase('shiftClosed');
      }
      if (canApprove && shift && shift.status !== 'APPROVED') {
        shift = await approveMutation.mutateAsync({ version: shift.version });
        setClosedShift(shift);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có bước chưa hoàn tất, vui lòng thử lại.');
    }
  }

  const isSaving = setAvailability.isPending || closeMutation.isPending || approveMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="eod-title">
      <div className="flex max-h-[92vh] w-full max-w-[820px] flex-col rounded-xl bg-white shadow-xl">
        <div className="flex-shrink-0 border-b border-slate-100 px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 id="eod-title" className="text-lg font-bold text-slate-900">
                Kết thúc ngày làm việc
              </h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {openShift.shiftLabel} · {openShift.cashierName} · Ca thu ngân đang mở từ {new Date(openShift.openedAt).toLocaleString('vi-VN')}
              </p>
            </div>
            {!closedShift && (
              <span className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-teal/25 bg-brand-teal-panel px-3 py-1.5 text-xs font-bold text-brand-teal-active">
                <CalendarBlank size={13} weight="bold" aria-hidden="true" />
                {formatTodayChipLabel(today)}
              </span>
            )}
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Đóng">
              <X size={20} weight="bold" aria-hidden="true" />
            </button>
          </div>

          {!closedShift && <WizardStepper labels={STEP_LABELS} currentStep={step} />}
        </div>

        <div className="scroll-hover flex-1 overflow-y-auto px-6 py-5">
          {closedShift ? (
            <div>
              <div className="mb-4 flex flex-col gap-2">
                <ChecklistRow>Ca khám đã đóng — {doctorSummaryQuery.data?.completedCount ?? 0} lượt hoàn thành, {doctorSummaryQuery.data?.cancelledCount ?? 0} huỷ</ChecklistRow>
                <ChecklistRow>Ca thu ngân đã chốt — nộp về {formatVnd(closedShift.submittedAmount ?? 0)}</ChecklistRow>
                {closedShift.status === 'APPROVED' && <ChecklistRow>Phiếu chốt ca đã tự động chuyển &quot;Đã duyệt&quot;</ChecklistRow>}
              </div>
              {clinicHeaderQuery.data && <CashierShiftReceiptView shift={closedShift} clinicHeader={clinicHeaderQuery.data} />}
            </div>
          ) : (
            <>
              {step === 1 && (
                <div>
                  {isScheduled && (
                    <div className="mb-4 flex items-start gap-2 rounded-r-lg border-l-[3px] border-rose-600 bg-rose-50 px-3.5 py-2.5 text-[13px] font-medium text-rose-800">
                      <Warning size={15} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                      Phòng khám đã đóng cửa — hệ thống tự nhắc, không phải bạn chủ động bấm.
                    </div>
                  )}
                  <DoctorShiftSummaryPanel doctorId={doctorId} />

                  <div className="mt-4">
                    <label htmlFor="eod-reason" className="mb-1 block text-sm font-semibold text-slate-800">
                      Lý do đóng ca <span className="font-normal text-slate-400">(không bắt buộc)</span>
                    </label>
                    <textarea
                      id="eod-reason"
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Ví dụ: đã khám hết bệnh nhân trong ngày"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  {pendingCount > 0 && (
                    <div className="mt-4 flex items-center gap-3 rounded-md bg-amber-50/70 py-2 pl-2.5 pr-3">
                      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-400 text-[15px] font-bold text-white">{pendingCount}</div>
                      <p className="text-xs leading-snug text-slate-700">
                        <span className="font-semibold text-slate-900">lượt khám chưa xử lý</span> — tự động chuyển về hàng chờ chung của Khoa.
                      </p>
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-2 text-xs font-bold text-blue-700">
                    <CheckCircle size={16} weight="fill" aria-hidden="true" />
                    Có ca thu ngân đang mở — sẽ gộp Chốt ca ngay sau bước này
                  </div>

                  <p className="mt-4 mb-3 text-sm font-medium text-slate-500">Hệ thống tự động tổng hợp mọi phiếu thu phát sinh trong ca — số liệu bên dưới không sửa được.</p>
                  <CloseShiftRevenueStep summary={summaryQuery.data} isPending={summaryQuery.isPending} blind={blind} openingFloatActual={openShift.openingFloatActual} />
                </div>
              )}

              {/* "Lập phiếu thu/chi" giữa chừng (CloseShiftDialog.tsx) KHÔNG có trong mockup đã
                  duyệt cho màn hình gộp này — cố ý bỏ (canCreateCashVoucher=false) thay vì để một
                  nút không nối gì (no-op), đúng nguyên tắc không tự ý thêm ngoài phạm vi đã chốt. */}
              {step === 2 && (
                <CloseShiftCountStep
                  countedAmount={countedAmount}
                  onChangeCountedAmount={setCountedAmount}
                  directEntry={directEntry}
                  onToggleDirectEntry={() => setDirectEntry((v) => !v)}
                  canCreateCashVoucher={false}
                  onOpenCashVoucherModal={() => {}}
                />
              )}

              {step === 3 && (
                <CloseShiftReconcileStep expected={expected} countedAmount={countedAmount} discrepancyReason={discrepancyReason} onChangeDiscrepancyReason={setDiscrepancyReason} />
              )}

              {step === 4 && (
                <CloseShiftHandoverStep
                  keepAmount={keepAmount}
                  onChangeKeepAmount={setKeepAmount}
                  submittedAmount={submittedAmount}
                  handoverNote={handoverNote}
                  onChangeHandoverNote={setHandoverNote}
                  error={error}
                  extraNotice={
                    <div className="mt-4 flex gap-2.5 rounded-lg border border-brand-teal/25 bg-brand-teal-tint px-4 py-3">
                      <CheckCircle size={16} weight="fill" className="mt-0.5 flex-shrink-0 text-brand-teal-active" aria-hidden="true" />
                      <p className="text-xs font-medium leading-relaxed text-brand-teal-active">
                        Sau khi xác nhận: ca khám <strong>đóng</strong>, ca thu ngân <strong>chốt</strong>
                        {canApprove ? (
                          <>
                            {' '}
                            và <strong>tự động Duyệt</strong> luôn (bạn đang có quyền Quản lý) — không cần thao tác Duyệt phiếu riêng.
                          </>
                        ) : (
                          '.'
                        )}
                      </p>
                    </div>
                  }
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
              <Button type="button" variant="success" onClick={() => void handleConfirm()} loading={isSaving}>
                Xác nhận &amp; Hoàn tất ngày làm việc
              </Button>
            )}
          </div>
        )}

        {closedShift && (
          <div className="flex flex-shrink-0 justify-end border-t border-slate-100 px-6 py-4">
            <Button type="button" onClick={onDone}>
              Về Hàng đợi khám
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChecklistRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
      <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <CheckCircle size={13} weight="bold" aria-hidden="true" />
      </span>
      <span className="text-[13.5px] font-bold text-emerald-800">{children}</span>
    </div>
  );
}
