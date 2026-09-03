import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowCounterClockwise, ArrowLeft, Bank, CheckCircle, CreditCard, Money, Printer, Receipt, Warning, XCircle } from '@phosphor-icons/react';
import type { PaymentMethod } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { CancelEncounterDialog } from '../../shared/ui/CancelEncounterDialog';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useAuthStore } from '../auth/auth.store';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { OpenShiftDialog } from '../cashier-shift/OpenShiftDialog';
import { useCurrentCashierShiftQuery } from '../cashier-shift/cashier-shift.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { InvoicePrintView } from './InvoicePrintView';
import {
  useBillingInvoiceQuery,
  useMarkInvoicePaidMutation,
  usePrintInvoiceMutation,
  useRefundInvoiceMutation,
  useRevertInvoicePaymentMutation,
  useSaveInvoiceDraftMutation,
} from './invoice.queries';

/** Icon riêng cho 2 mã mặc định (seed sẵn, xem migration `20260827121000_seed_payment_method_catalog`) — mã tuỳ biến khác dùng icon chung. */
const PAYMENT_METHOD_ICON: Record<string, typeof Money> = {
  CASH: Money,
  BANK_TRANSFER: Bank,
};

/** #085 — hoàn tiền là thao tác nhạy cảm hơn thu tiền, mặc định CHỈ clinic_admin (khớp `invoice.refund` ở ma trận mặc định, `packages/core/src/rbac/permissions.ts`). Ẩn hẳn nút với vai trò không có quyền, đúng `.claude/docs/ui-guidelines.md` mục 9. */
const REFUND_ROLES = ['clinic_admin'];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${min} · ${dd}/${mm}/${vn.getUTCFullYear()}`;
}

const methodChipBase = 'flex items-center justify-center gap-1.5 rounded-md border-2 px-3 py-2 text-[13px] font-bold transition-colors';
const methodChipUnselected = 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-brand-teal-tint';
const methodChipSelected = 'border-brand-teal bg-brand-teal text-white';

/**
 * "Chi tiết thanh toán" (Sprint 5/6, BIL-01→04) — trang riêng (không phải slide-over), đúng mockup
 * đã duyệt qua Artifact trước khi code (tham khảo bố cục MedPOS). Chưa thu: chọn phương thức +
 * (nếu tiền mặt) máy tính tiền khách đưa/tiền trả lại, "Lưu tạm" (F8, không đổi status) + "Thu tiền
 * & In phiếu" (F9). Đã thu: "In lại phiếu" + "Đánh dấu chưa thu" (yêu cầu lý do).
 */
export function InvoiceDetailPage() {
  const { encounterId = '' } = useParams<{ encounterId: string }>();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const collectedByName = currentUser?.displayName ?? currentUser?.fullName ?? '';
  const canRefund = currentUser?.roles.some((role) => REFUND_ROLES.includes(role)) ?? false;

  const invoiceQuery = useBillingInvoiceQuery(encounterId);
  const clinicQuery = useClinicPrintHeaderQuery();
  const paymentMethodQuery = useReferenceCatalogQuery('PAYMENT_METHOD');
  // "Thu tiền" đòi có ca thu ngân đang mở (đối soát tiền mặt, #chốt-ca) — không chặn cả trang, chỉ
  // chặn đúng thao tác chạm tới tiền (chốt qua AskUserQuestion, đảo hướng 2026-09-03).
  const currentShiftQuery = useCurrentCashierShiftQuery();
  const openShift = currentShiftQuery.data?.openShift ?? null;
  const shiftFeatureUnavailable = currentShiftQuery.isError && currentShiftQuery.error instanceof ApiError && currentShiftQuery.error.code === 'PERMISSION_DENIED';
  const [openShiftDialogVisible, setOpenShiftDialogVisible] = useState(false);
  const invoice = invoiceQuery.data ?? null;
  const paymentMethods = useMemo(() => paymentMethodQuery.data?.items.filter((i) => i.isActive) ?? [], [paymentMethodQuery.data]);
  const paymentMethodName = (code: PaymentMethod | null) => paymentMethods.find((i) => i.code === code)?.name ?? code ?? '—';

  useBreadcrumb([{ label: 'Thu ngân', to: '/billing' }, { label: invoice?.invoiceNo ?? 'Chi tiết thanh toán' }]);

  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [cashReceived, setCashReceived] = useState<number | undefined>(undefined);
  const [revertReason, setRevertReason] = useState('');
  const [revertOpen, setRevertOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #085 — "Khách bỏ về/Huỷ lượt khám" ngay tại đây (dùng chung CancelEncounterDialog) + "Hoàn
  // tiền" riêng cho phiếu đã thu của lượt khám đã huỷ, bắt buộc lý do.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);

  // Khôi phục "Lưu tạm" (F8) nếu có — nạp đúng 1 lần khi dữ liệu về, không ghi đè lúc người dùng đang gõ dở.
  useEffect(() => {
    if (invoice && invoice.status === 'UNPAID') {
      if (invoice.pendingPaymentMethod) setMethod(invoice.pendingPaymentMethod);
      if (invoice.pendingCashReceivedAmount !== null) setCashReceived(invoice.pendingCashReceivedAmount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  const payMutation = useMarkInvoicePaidMutation(encounterId);
  const revertMutation = useRevertInvoicePaymentMutation(encounterId);
  const draftMutation = useSaveInvoiceDraftMutation(encounterId);
  const printMutation = usePrintInvoiceMutation(encounterId);
  const refundMutation = useRefundInvoiceMutation(encounterId);

  const changeAmount = method === 'CASH' && cashReceived !== undefined ? cashReceived - (invoice?.totalAmount ?? 0) : null;

  async function handlePay() {
    if (!invoice) return;
    // Chưa có ca thu ngân nào đang mở — bật popup "Mở ca" trước, mở xong tự chạy lại đúng thao tác
    // thu tiền này (không bắt bấm "Thu tiền" lại lần 2).
    if (!shiftFeatureUnavailable && !openShift) {
      setOpenShiftDialogVisible(true);
      return;
    }
    setError(null);
    try {
      await payMutation.mutateAsync({ method, version: invoice.version });
      setTimeout(() => window.print(), 100);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handleSaveDraft() {
    if (!invoice) return;
    setError(null);
    try {
      await draftMutation.mutateAsync({ pendingPaymentMethod: method, pendingCashReceivedAmount: cashReceived ?? null, version: invoice.version });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handlePrintAgain() {
    if (!invoice) return;
    await printMutation.mutateAsync();
    setTimeout(() => window.print(), 100);
  }

  async function handleRevert() {
    if (!invoice || revertReason.trim() === '') return;
    setError(null);
    try {
      await revertMutation.mutateAsync({ reason: revertReason.trim(), version: invoice.version });
      setRevertOpen(false);
      setRevertReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handleRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice || refundReason.trim() === '') return;
    setError(null);
    try {
      await refundMutation.mutateAsync({ reason: refundReason.trim(), version: invoice.version });
      setRefundOpen(false);
      setRefundReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h1 className="sr-only">Chi tiết thanh toán</h1>

      <button
        type="button"
        onClick={() => navigate('/billing')}
        className="flex w-fit items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft size={15} weight="bold" aria-hidden="true" />
        Danh sách Thu ngân
      </button>

      {invoiceQuery.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {invoiceQuery.isError && (
        <ErrorBanner
          message={invoiceQuery.error instanceof ApiError ? invoiceQuery.error.message : 'Không tải được phiếu thu.'}
          onRetry={() => void invoiceQuery.refetch()}
        />
      )}

      {invoiceQuery.isSuccess && invoice === null && (
        <EmptyState icon={Receipt} title="Lượt khám này không có phiếu thu" description="Chưa có dịch vụ nào đã cấu hình đơn giá được chỉ định lúc tiếp nhận." />
      )}

      {invoice && (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-base font-bold text-slate-900">
              Phiếu thu <span className="text-blue-600">{invoice.invoiceNo}</span>
            </h2>
            {invoice.status === 'PAID' && (
              <StatusBadge tone="success">
                <CheckCircle size={12} weight="bold" aria-hidden="true" /> Đã thu
              </StatusBadge>
            )}
            {invoice.status === 'UNPAID' && <StatusBadge tone="warning">Chờ thu</StatusBadge>}
            {/* #085 — CANCELLED (huỷ khi chưa thu)/REFUNDED (đã hoàn tiền xong) là 2 trạng thái đóng sổ mới. */}
            {invoice.status === 'CANCELLED' && (
              <StatusBadge tone="neutral">
                <XCircle size={12} weight="bold" aria-hidden="true" /> Đã huỷ (chưa thu)
              </StatusBadge>
            )}
            {invoice.status === 'REFUNDED' && (
              <StatusBadge tone="accent">
                <ArrowLeft size={12} weight="bold" aria-hidden="true" /> Đã hoàn tiền
              </StatusBadge>
            )}
            {invoice.needsRefund && (
              <StatusBadge tone="danger">
                <Warning size={12} weight="fill" aria-hidden="true" /> Cần hoàn tiền
              </StatusBadge>
            )}
            {/* #085 — "Hủy lượt khám" ngay tại đây, dùng chung dialog. Ẩn khi lượt khám đã huỷ rồi
                (encounterCancelled) — không huỷ lại lần 2. */}
            {!invoice.encounterCancelled && (
              <Button type="button" variant="danger" className="ml-auto px-2.5 py-1 text-xs" onClick={() => setCancelOpen(true)}>
                <XCircle size={13} weight="bold" aria-hidden="true" />
                Hủy lượt khám
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
            <div>
              <p className="text-[17px] font-bold text-slate-900">{invoice.fullName}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-600">
                <span>Mã BN: {invoice.patientCode}</span>
                <span>Lượt khám: {invoice.encounterNo}</span>
                <span>Tiếp nhận: {formatDateTime(invoice.checkedInAt)}</span>
                <span>Khoa: {invoice.departmentName}</span>
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm font-semibold text-rose-600">
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-700">
                Dịch vụ đã chỉ định (Tiếp nhận)
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                    <th className="px-3 py-2.5 text-left">Dịch vụ</th>
                    <th className="px-3 py-2.5 text-center">SL</th>
                    <th className="px-3 py-2.5 text-right">Đơn giá</th>
                    <th className="px-3 py-2.5 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line) => (
                    <tr key={line.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-3 text-left">
                        <div className="font-semibold text-slate-900">{line.examTypeName}</div>
                        <div className="text-xs text-slate-500">{line.examTypeCode}</div>
                      </td>
                      <td className="px-3 py-3 text-center font-medium text-slate-700">{line.quantity}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-700">{formatVnd(line.unitPrice)}</td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums text-slate-900">{formatVnd(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3.5 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-baseline justify-between border-b border-dashed border-slate-200 pb-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Cần thu</span>
                <span className="text-2xl font-bold tabular-nums text-slate-900">{formatVnd(invoice.totalAmount)}</span>
              </div>

              {invoice.status === 'UNPAID' ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold text-slate-700">Phương thức thanh toán</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {paymentMethods.map((item) => {
                        const IconComponent = PAYMENT_METHOD_ICON[item.code] ?? CreditCard;
                        return (
                          <button
                            key={item.code}
                            type="button"
                            onClick={() => setMethod(item.code)}
                            className={`${methodChipBase} ${method === item.code ? methodChipSelected : methodChipUnselected}`}
                          >
                            <IconComponent size={15} weight="regular" aria-hidden="true" />
                            {item.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {method === 'CASH' && (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="invoice-cash-received" className="text-xs font-bold text-slate-700">
                        Tiền khách đưa
                      </label>
                      <MoneyInput
                        id="invoice-cash-received"
                        value={cashReceived}
                        onChange={setCashReceived}
                        className="rounded-md border-2 border-slate-300 px-3 py-2 text-right text-base font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                      {changeAmount !== null && changeAmount >= 0 && (
                        <div className="flex items-baseline justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                          <span className="text-xs font-bold text-emerald-700">Tiền trả lại</span>
                          <span className="text-lg font-bold tabular-nums text-emerald-700">{formatVnd(changeAmount)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <Button type="button" variant="secondary" onClick={() => void handleSaveDraft()} loading={draftMutation.isPending}>
                      Lưu tạm
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handlePay()}
                      loading={payMutation.isPending}
                      disabled={method === 'CASH' && changeAmount !== null && changeAmount < 0}
                    >
                      <Receipt size={16} weight="bold" aria-hidden="true" />
                      Thu tiền &amp; In phiếu
                    </Button>
                  </div>
                </>
              ) : invoice.status === 'CANCELLED' ? (
                // #085 — huỷ khi CHƯA thu tiền: không có gì để thu/hoàn, không có phương thức/ngày thu.
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
                  Lượt khám này đã bị huỷ trước khi thu tiền — phiếu thu đóng lại, không tính vào tổng kết cuối ngày.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-[13px] text-slate-600">
                    Phương thức: <strong className="text-slate-900">{paymentMethodName(invoice.paymentMethod)}</strong>
                    {invoice.paidAt && <> · {formatDateTime(invoice.paidAt)}</>}
                  </p>
                  {/* #085 — REFUNDED: hiện thêm vết hoàn tiền, KHÔNG còn "Đánh dấu chưa thu" (đã đóng sổ). */}
                  {invoice.status === 'REFUNDED' && (
                    <p className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2.5 text-[13px] text-violet-800">
                      Đã hoàn {formatVnd(invoice.totalAmount)}
                      {invoice.refundedAt && <> · {formatDateTime(invoice.refundedAt)}</>}
                      {invoice.refundReason && (
                        <>
                          <br />
                          Lý do: {invoice.refundReason}
                        </>
                      )}
                    </p>
                  )}
                  <Button type="button" onClick={() => void handlePrintAgain()} loading={printMutation.isPending}>
                    <Printer size={16} weight="bold" aria-hidden="true" />
                    In lại phiếu thu
                  </Button>
                  {/* #085 — "Hoàn tiền" chỉ hiện khi ĐỦ điều kiện (PAID + lượt khám đã huỷ) VÀ vai
                      trò có quyền `invoice.refund` (mặc định chỉ clinic_admin). */}
                  {invoice.needsRefund && canRefund && (
                    <Button type="button" variant="danger" onClick={() => setRefundOpen(true)}>
                      Hoàn tiền
                    </Button>
                  )}
                  {invoice.status === 'PAID' && !invoice.encounterCancelled && (
                    <button type="button" onClick={() => setRevertOpen(true)} className="text-xs font-semibold text-slate-500 underline hover:text-rose-600">
                      Đánh dấu chưa thu
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <InvoicePrintView
            clinicName={clinicQuery.data?.name ?? ''}
            clinicAddress={clinicQuery.data?.address ?? null}
            clinicPhone={clinicQuery.data?.phone ?? null}
            printLogoUrl={clinicQuery.data?.printLogoUrl ?? null}
            collectedByName={collectedByName}
            paymentMethodLabel={paymentMethodName(invoice.paymentMethod)}
            invoice={invoice}
          />
        </>
      )}

      {revertOpen && invoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Đánh dấu chưa thu?</h3>
            <p className="mt-1.5 text-sm text-slate-600">Phiếu thu quay lại trạng thái &quot;Chờ thu&quot;. Bắt buộc nhập lý do.</p>
            <label htmlFor="revert-reason" className="mt-3 block text-sm font-semibold text-slate-800">
              Lý do
            </label>
            <textarea
              id="revert-reason"
              rows={3}
              value={revertReason}
              onChange={(e) => setRevertReason(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Ví dụ: đánh dấu nhầm phiếu"
            />
            <div className="mt-4 flex justify-end gap-2.5">
              <Button type="button" variant="secondary" onClick={() => setRevertOpen(false)}>
                Huỷ
              </Button>
              <Button type="button" variant="danger" onClick={() => void handleRevert()} disabled={revertReason.trim() === ''} loading={revertMutation.isPending}>
                Xác nhận
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Đồng bộ khuôn với `CancelEncounterDialog.tsx` (overlay /45, p-4 ngoài/p-5 trong, rounded-lg,
          shadow-xl theo .claude/docs/ui-guidelines.md mục 2.2, <form> để Enter submit được — mục
          4.4 — và huy hiệu tròn nổi bật số tiền thay khung chữ thuần, đúng khuôn #095). */}
      {refundOpen && invoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="refund-title">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <form onSubmit={(e) => void handleRefund(e)}>
              <p id="refund-title" className="text-sm font-semibold text-slate-900">
                Hoàn tiền?
              </p>
              <p className="mt-1.5 text-xs text-slate-500">Lượt khám này đã huỷ. Chỉ hoàn TOÀN PHẦN, không sửa lại được.</p>

              <div className="mt-3 flex items-center gap-3 rounded-md bg-violet-50/70 py-2.5 pl-2.5 pr-3">
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-violet-500 text-white">
                  <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
                </div>
                <p className="text-xs leading-snug text-slate-700">
                  Trả lại <span className="text-sm font-bold text-slate-900">{formatVnd(invoice.totalAmount)}</span> cho khách.
                </p>
              </div>

              <div className="mt-3.5">
                <label htmlFor="refund-reason" className="mb-1 block text-sm font-semibold text-slate-800">
                  Lý do <span className="text-rose-500">*</span>
                </label>
                <textarea
                  id="refund-reason"
                  rows={3}
                  required
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Ví dụ: khách bỏ về, chưa dùng dịch vụ nào"
                />
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setRefundOpen(false)}>
                  Đóng
                </Button>
                <Button type="submit" variant="danger" disabled={refundReason.trim() === ''} loading={refundMutation.isPending}>
                  Xác nhận hoàn tiền
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {cancelOpen && invoice && (
        <CancelEncounterDialog
          encounterId={invoice.encounterId}
          version={invoice.encounterVersion}
          onCancelled={() => setCancelOpen(false)}
          onClose={() => setCancelOpen(false)}
        />
      )}

      {openShiftDialogVisible && currentShiftQuery.isSuccess && !openShift && (
        <OpenShiftDialog
          previousClosedShift={currentShiftQuery.data.previousClosedShift}
          onCancel={() => setOpenShiftDialogVisible(false)}
          onSuccess={() => {
            setOpenShiftDialogVisible(false);
            void handlePay();
          }}
        />
      )}
    </div>
  );
}
