import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowCounterClockwise, ArrowLeft, Bank, CheckCircle, CreditCard, Money, Printer, Receipt, Wallet, Warning, XCircle } from '@phosphor-icons/react';
import type { DiscountType, PaymentMethod } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { CancelEncounterDialog } from '../../shared/ui/CancelEncounterDialog';
import { CashTenderPills } from '../../shared/ui/CashTenderPills';
import { TwoOptionToggle } from '../../shared/ui/TwoOptionToggle';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { useClinicPrintHeaderQuery, useClinicSettingsQuery } from '../clinic/clinic.queries';
import { OpenShiftDialog } from '../cashier-shift/OpenShiftDialog';
import { useCurrentCashierShiftQuery } from '../cashier-shift/cashier-shift.queries';
import { useCashierShiftRequiredEnabledQuery } from '../clinic/clinic.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useWalletQuery } from '../patient-wallet/patient-wallet.queries';
import { InvoicePrintView } from './InvoicePrintView';
import {
  useApplyInvoiceDiscountMutation,
  useBillingInvoiceQuery,
  useMarkInvoicePaidMutation,
  usePayInvoiceWithWalletMutation,
  usePrintInvoiceMutation,
  useRefundInvoiceMutation,
  useRevertInvoicePaymentMutation,
  useSaveInvoiceDraftMutation,
  useTopUpAndPayInvoiceWithWalletMutation,
} from './invoice.queries';

/** Icon riêng cho 3 mã mặc định (seed sẵn — CASH/BANK_TRANSFER ở migration `20260827121000_seed_payment_method_catalog`, WALLET ở `20260909100000_patient_wallet`) — mã tuỳ biến khác dùng icon chung. */
const PAYMENT_METHOD_ICON: Record<string, typeof Money> = {
  CASH: Money,
  BANK_TRANSFER: Bank,
  WALLET: Wallet,
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${min} · ${dd}/${mm}/${vn.getUTCFullYear()}`;
}

const methodChipBase = 'flex items-center justify-center gap-1.5 rounded-md border-2 px-3 py-2 text-[14px] font-bold transition-colors';
const methodChipUnselected = 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-brand-teal-tint';
const methodChipSelected = 'border-brand-teal bg-brand-teal text-white';

// Chiết khấu — nhập inline (không popup, chốt qua AskUserQuestion): 2 lựa chọn %/Tiền dùng
// `TwoOptionToggle` (shared/ui) cho cả khối "Chiết khấu tổng" lẫn từng dòng dịch vụ trong bảng.
const DISCOUNT_TYPE_OPTIONS = [
  { value: 'PERCENT', label: '%' },
  { value: 'AMOUNT', label: 'VNĐ' },
] as const;

// Mặc định chỉ hiện 2 lựa chọn cách chiết khấu — chọn 1 trong 2 mới hiện ô nhập tương ứng (chốt
// theo yêu cầu trực tiếp), chưa chọn gì = giữ nguyên UNPAID không chiết khấu.
const DISCOUNT_MODE_OPTIONS = [
  { value: 'PER_LINE', label: 'Từng dịch vụ' },
  { value: 'TOTAL', label: 'Toàn hoá đơn' },
] as const;

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
  const canRefund = useHasPermission('invoice', 'refund');

  const invoiceQuery = useBillingInvoiceQuery(encounterId);
  const clinicQuery = useClinicPrintHeaderQuery();
  const paymentMethodQuery = useReferenceCatalogQuery('PAYMENT_METHOD');
  // "Thu tiền" đòi có ca thu ngân đang mở (đối soát tiền mặt, #chốt-ca) — không chặn cả trang, chỉ
  // chặn đúng thao tác chạm tới tiền (chốt qua AskUserQuestion, đảo hướng 2026-09-03). Công tắc
  // "Yêu cầu mở ca trước khi thu tiền" (2026-09-04) cho phòng khám nhỏ tắt hẳn gate này — mặc định
  // `true` trong lúc đang tải để giữ đúng hành vi an toàn cũ (chỉ suy đoán "không cần gate" sau khi
  // biết chắc tenant đã chủ động tắt).
  const shiftRequiredQuery = useCashierShiftRequiredEnabledQuery();
  const shiftRequired = shiftRequiredQuery.data?.enabled ?? true;
  const currentShiftQuery = useCurrentCashierShiftQuery();
  const openShift = currentShiftQuery.data?.openShift ?? null;
  const shiftFeatureUnavailable = currentShiftQuery.isError && currentShiftQuery.error instanceof ApiError && currentShiftQuery.error.code === 'PERMISSION_DENIED';
  const [openShiftDialogVisible, setOpenShiftDialogVisible] = useState(false);
  const invoice = invoiceQuery.data ?? null;
  const paymentMethods = useMemo(() => paymentMethodQuery.data?.items.filter((i) => i.isActive) ?? [], [paymentMethodQuery.data]);
  const paymentMethodName = (code: PaymentMethod | null) => paymentMethods.find((i) => i.code === code)?.name ?? code ?? '—';
  // Ví tạm ứng — chip riêng tách khỏi lưới phương thức thường (mockup đã chốt), nhóm còn lại
  // KHÔNG hiện 'WALLET' lần thứ 2 trong lưới.
  const nonWalletMethods = useMemo(() => paymentMethods.filter((i) => i.code !== 'WALLET'), [paymentMethods]);

  const walletQuery = useWalletQuery(invoice?.patientId ?? '');
  const wallet = walletQuery.data ?? null;
  const walletActive = wallet?.status === 'ACTIVE';
  const clinicSettingsQuery = useClinicSettingsQuery();
  const mixedPaymentEnabled = clinicSettingsQuery.data?.walletMixedPaymentEnabled ?? false;

  useBreadcrumb([{ label: 'Thu ngân', to: '/billing' }, { label: invoice?.invoiceNo ?? 'Chi tiết thanh toán' }]);

  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [cashReceived, setCashReceived] = useState<number | undefined>(undefined);
  const [useHybrid, setUseHybrid] = useState(false);
  const [hybridRemainderMethod, setHybridRemainderMethod] = useState('');
  const [revertReason, setRevertReason] = useState('');
  const [revertOpen, setRevertOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #085 — "Khách bỏ về/Huỷ lượt khám" ngay tại đây (dùng chung CancelEncounterDialog) + "Hoàn
  // tiền" riêng cho phiếu đã thu của lượt khám đã huỷ, bắt buộc lý do.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  // "Nạp phần thiếu"/"Nạp mức chuẩn" — bấm là nạp tiền + trừ ví + đóng phiếu ngay (1 thao tác, theo
  // PRD), nhưng KHÔNG được chạy thẳng không hỏi lại — giữ số tiền dự định nạp ở đây để mở dialog
  // xác nhận trước, tránh bấm nhầm làm mất tiền (chủ dự án phản hồi trực tiếp, đúng khuôn xác nhận
  // của RefundDialog/CancelEncounterDialog — mọi thao tác đụng tiền trong app đều qua 1 bước xác nhận).
  const [quickTopUpAmount, setQuickTopUpAmount] = useState<number | null>(null);
  // "Nhập số khác" — cho gõ tay 1 mức nạp tuỳ ý ngay tại khối gợi ý (khác 2 mức có sẵn), dùng
  // chung dialog xác nhận với `quickTopUpAmount` ở trên.
  const [customTopUpOpen, setCustomTopUpOpen] = useState(false);
  const [customTopUpAmount, setCustomTopUpAmount] = useState<number | undefined>(undefined);
  // Chiết khấu — nhập inline (không popup): mặc định chỉ hiện 2 lựa chọn "Từng dịch vụ"/"Toàn hoá
  // đơn" (chốt theo yêu cầu trực tiếp), chọn 1 trong 2 mới hiện ô nhập tương ứng — `null` = chưa
  // chọn gì (đúng trạng thái phiếu chưa có chiết khấu). `discountReason` dùng CHUNG cho cả 2 cách.
  const [discountReason, setDiscountReason] = useState('');
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [discountEditMode, setDiscountEditMode] = useState<'TOTAL' | 'PER_LINE' | null>(null);
  const [totalDiscountType, setTotalDiscountType] = useState<DiscountType>('PERCENT');
  const [totalDiscountValue, setTotalDiscountValue] = useState<number | undefined>(undefined);
  // Mỗi dòng LUÔN có sẵn `type` (mặc định PERCENT, giống khung tổng — chốt theo yêu cầu trực tiếp)
  // — "không chiết khấu dòng này" chỉ được biểu diễn bằng `value` rỗng, không phải `type` rỗng, để
  // tránh trạng thái dở dang "đã chọn kiểu nhưng chưa gõ số" gửi lên nửa vời.
  const [lineDiscounts, setLineDiscounts] = useState<Record<string, { type: DiscountType; value: number | undefined }>>({});

  // Ví tạm ứng — số tiền còn thiếu nếu chọn WALLET (0 nếu đủ hoặc chưa chọn WALLET). Dùng
  // `dueAmount` (sau chiết khấu), KHÔNG phải `totalAmount` (gross).
  const walletShortfall = method === 'WALLET' && invoice ? Math.max(0, invoice.dueAmount - (wallet?.balance ?? 0)) : 0;
  const walletCovered = method === 'WALLET' && invoice ? Math.min(wallet?.balance ?? 0, invoice.dueAmount) : 0;

  // Khôi phục "Lưu tạm" (F8) nếu có — nạp đúng 1 lần khi dữ liệu về, không ghi đè lúc người dùng đang gõ dở.
  useEffect(() => {
    if (invoice && invoice.status === 'UNPAID') {
      if (invoice.pendingPaymentMethod) setMethod(invoice.pendingPaymentMethod);
      if (invoice.pendingCashReceivedAmount !== null) setCashReceived(invoice.pendingCashReceivedAmount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  // Chiết khấu — nạp lại đúng trạng thái đã lưu mỗi khi `discountMode` đổi (kể cả do CHÍNH lượt
  // lưu vừa rồi của trang này) — không nạp lại theo mọi refetch khác (đổi phương thức thanh
  // toán...) để không ghi đè lúc người dùng đang gõ dở ở phần chiết khấu. RIÊNG "Lý do" KHÔNG nạp
  // sẵn từ `invoice.discountReason` (chốt theo yêu cầu trực tiếp) — mỗi lần sửa chiết khấu phải tự
  // gõ lý do MỚI, tránh vô tình giữ nguyên lý do cũ không còn đúng cho lần sửa này.
  useEffect(() => {
    if (invoice) {
      setDiscountEditMode(invoice.discountMode === 'NONE' ? null : invoice.discountMode);
      setTotalDiscountType(invoice.discountType ?? 'PERCENT');
      setTotalDiscountValue(invoice.discountValue ?? undefined);
      setLineDiscounts(Object.fromEntries(invoice.lines.map((l) => [l.id, { type: l.discountType ?? 'PERCENT', value: l.discountValue ?? undefined }])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, invoice?.discountMode]);

  const payMutation = useMarkInvoicePaidMutation(encounterId);
  const payWithWalletMutation = usePayInvoiceWithWalletMutation(encounterId);
  const topUpAndPayMutation = useTopUpAndPayInvoiceWithWalletMutation(encounterId);
  const revertMutation = useRevertInvoicePaymentMutation(encounterId);
  const draftMutation = useSaveInvoiceDraftMutation(encounterId);
  const printMutation = usePrintInvoiceMutation(encounterId);
  const refundMutation = useRefundInvoiceMutation(encounterId);
  const discountMutation = useApplyInvoiceDiscountMutation(encounterId);

  /** Chiết khấu — tự lưu khi rời ô nhập (chốt qua AskUserQuestion), lý do dùng CHUNG bắt buộc. */
  function requireDiscountReason(): string | null {
    const trimmed = discountReason.trim();
    if (!trimmed) {
      setDiscountError('Nhập lý do trước khi lưu chiết khấu.');
      return null;
    }
    setDiscountError(null);
    return trimmed;
  }

  async function saveTotalDiscount() {
    if (!invoice) return;
    const hasValue = !!totalDiscountValue && totalDiscountValue > 0;
    // Không có gì thay đổi thật (ô đang trống, phiếu vốn cũng chưa có chiết khấu) — bỏ qua êm,
    // KHÔNG đòi lý do (tránh báo lỗi phiền khi người dùng chỉ lỡ bấm vào rồi rời ô ngay).
    if (!hasValue && invoice.discountMode === 'NONE') return;
    const reason = requireDiscountReason();
    if (reason === null) return;
    try {
      if (!hasValue) {
        await discountMutation.mutateAsync({ mode: 'NONE', reason, version: invoice.version });
      } else {
        await discountMutation.mutateAsync({ mode: 'TOTAL', discountType: totalDiscountType, discountValue: totalDiscountValue!, reason, version: invoice.version });
      }
    } catch (err) {
      setDiscountError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function saveLineDiscounts() {
    if (!invoice) return;
    const lines = invoice.lines.map((l) => {
      const draft = lineDiscounts[l.id];
      const hasValue = !!draft?.value && draft.value > 0;
      return { lineId: l.id, discountType: hasValue ? draft!.type : null, discountValue: hasValue ? draft!.value! : null };
    });
    const hasAny = lines.some((l) => l.discountType !== null);
    if (!hasAny && invoice.discountMode === 'NONE') return;
    const reason = requireDiscountReason();
    if (reason === null) return;
    try {
      if (!hasAny) {
        await discountMutation.mutateAsync({ mode: 'NONE', reason, version: invoice.version });
      } else {
        await discountMutation.mutateAsync({ mode: 'PER_LINE', lines, reason, version: invoice.version });
      }
    } catch (err) {
      setDiscountError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  function updateLineDiscount(lineId: string, patch: Partial<{ type: DiscountType; value: number | undefined }>) {
    setLineDiscounts((prev) => ({ ...prev, [lineId]: { type: prev[lineId]?.type ?? 'PERCENT', value: prev[lineId]?.value, ...patch } }));
  }

  const changeAmount = method === 'CASH' && cashReceived !== undefined ? cashReceived - (invoice?.dueAmount ?? 0) : null;

  async function handlePay() {
    if (!invoice) return;
    // Chưa có ca thu ngân nào đang mở — bật popup "Mở ca" trước, mở xong tự chạy lại đúng thao tác
    // thu tiền này (không bắt bấm "Thu tiền" lại lần 2). Bỏ hẳn khi tenant đã tắt "Yêu cầu mở ca
    // trước khi thu tiền" (phòng khám nhỏ 1 người kiêm tiếp nhận/thu ngân/khám).
    if (shiftRequired && !shiftFeatureUnavailable && !openShift) {
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

  /** Ví tạm ứng — trừ ví hiện có (`topUpAmount` bỏ trống) hoặc nạp thêm rồi trừ ngay (2 nút gợi ý khi thiếu).
   * Trả `true`/`false` để nơi gọi (dialog xác nhận "Nạp phần thiếu"/"Nạp mức chuẩn") biết đóng dialog
   * đúng lúc thành công — KHÔNG đóng khi lỗi, để lỗi vẫn hiện + giữ dialog cho thử lại. */
  async function handlePayWithWallet(topUpAmount?: number): Promise<boolean> {
    if (!invoice) return false;
    if (shiftRequired && !shiftFeatureUnavailable && !openShift) {
      setOpenShiftDialogVisible(true);
      return false;
    }
    setError(null);
    try {
      const remainderPaymentMethodCode = useHybrid && hybridRemainderMethod ? hybridRemainderMethod : undefined;
      if (topUpAmount) {
        await topUpAndPayMutation.mutateAsync({
          version: invoice.version,
          topUpAmount,
          topUpPaymentMethodCode: 'CASH',
          remainderPaymentMethodCode,
        });
      } else {
        await payWithWalletMutation.mutateAsync({ version: invoice.version, remainderPaymentMethodCode });
      }
      setTimeout(() => window.print(), 100);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
      return false;
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
            {/* Ví tạm ứng — chip số dư NGAY trong dải thông tin khách hàng (mockup đã chốt), chỉ hiện
                khi bệnh nhân có ví ACTIVE. Xanh lá khi đủ chi trả phiếu đang xem, hổ phách khi thiếu. */}
            {walletActive && wallet && (
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
                  wallet.balance >= invoice.dueAmount ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
                }`}
              >
                <Wallet size={16} weight="fill" className={wallet.balance >= invoice.dueAmount ? 'text-emerald-700' : 'text-amber-700'} aria-hidden="true" />
                <div>
                  <div className={`text-[10px] font-bold uppercase tracking-wide ${wallet.balance >= invoice.dueAmount ? 'text-emerald-700' : 'text-amber-700'}`}>
                    Số dư ví
                  </div>
                  <div className={`text-[15px] font-bold leading-tight ${wallet.balance >= invoice.dueAmount ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {formatVnd(wallet.balance)}
                  </div>
                </div>
              </div>
            )}
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
                    {/* Cột "Chiết khấu" chỉ hiện khi đã chọn cách "Từng dịch vụ" ở khung bên phải. */}
                    {discountEditMode === 'PER_LINE' && <th className="px-3 py-2.5 text-right">Chiết khấu</th>}
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line) => {
                    const draft = lineDiscounts[line.id];
                    return (
                      <tr key={line.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-3 text-left">
                          <div className="font-semibold text-slate-900">{line.examTypeName}</div>
                          <div className="text-xs text-slate-500">{line.examTypeCode}</div>
                        </td>
                        <td className="px-3 py-3 text-center font-medium text-slate-700">{line.quantity}</td>
                        <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-700">{formatVnd(line.unitPrice)}</td>
                        <td className="px-3 py-3 text-right font-bold tabular-nums text-slate-900">{formatVnd(line.lineTotal)}</td>
                        {discountEditMode === 'PER_LINE' && (
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <input
                                type="number"
                                min={1}
                                max={draft?.type === 'PERCENT' ? 100 : undefined}
                                disabled={discountMutation.isPending}
                                value={draft?.value ?? ''}
                                onChange={(e) => updateLineDiscount(line.id, { value: e.target.value === '' ? undefined : Number(e.target.value) })}
                                onBlur={() => void saveLineDiscounts()}
                                placeholder="0"
                                className="w-20 rounded-md border-2 border-slate-300 px-2 py-1.5 text-right text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-300"
                              />
                              {/* Mặc định %, giống khung tổng — "không chiết khấu dòng này" chỉ cần
                                  để trống ô số, không cần bỏ chọn kiểu (chốt theo yêu cầu trực tiếp). */}
                              <TwoOptionToggle
                                options={DISCOUNT_TYPE_OPTIONS}
                                value={draft?.type ?? 'PERCENT'}
                                disabled={discountMutation.isPending}
                                onChange={(next) => {
                                  if (next !== null) updateLineDiscount(line.id, { type: next });
                                }}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3.5 rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-1.5 border-b border-dashed border-slate-200 pb-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tạm tính</span>
                  <span className="text-sm font-bold tabular-nums text-slate-700">{formatVnd(invoice.totalAmount)}</span>
                </div>

                {/* Chiết khấu — mặc định chỉ hiện 2 lựa chọn cách làm, chọn 1 trong 2 mới hiện ô
                    nhập tương ứng (chốt theo yêu cầu trực tiếp). "Từng dịch vụ" nhập ở bảng bên
                    trái; "Toàn hoá đơn" nhập ngay tại đây, tự lưu khi rời ô. */}
                {invoice.status === 'UNPAID' && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Chiết khấu</span>
                      <TwoOptionToggle options={DISCOUNT_MODE_OPTIONS} value={discountEditMode} disabled={discountMutation.isPending} onChange={setDiscountEditMode} />
                    </div>
                    {discountEditMode === 'TOTAL' && (
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="number"
                          min={1}
                          max={totalDiscountType === 'PERCENT' ? 100 : undefined}
                          disabled={discountMutation.isPending}
                          value={totalDiscountValue ?? ''}
                          onChange={(e) => setTotalDiscountValue(e.target.value === '' ? undefined : Number(e.target.value))}
                          onBlur={() => void saveTotalDiscount()}
                          placeholder="0"
                          className="w-20 rounded-md border-2 border-slate-300 px-2 py-1.5 text-right text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-300"
                        />
                        {/* Luôn có 1 kiểu đang chọn (bỏ chiết khấu = xoá Ô GIÁ TRỊ, không phải bỏ
                            chọn kiểu) — bấm lại đúng kiểu đang chọn không làm gì. */}
                        <TwoOptionToggle
                          options={DISCOUNT_TYPE_OPTIONS}
                          value={totalDiscountType}
                          disabled={discountMutation.isPending}
                          onChange={(next) => {
                            if (next !== null) setTotalDiscountType(next);
                          }}
                        />
                      </div>
                    )}
                    {discountEditMode === 'PER_LINE' && <p className="text-[11px] text-slate-500">Nhập trực tiếp ở cột "Chiết khấu" trong bảng dịch vụ bên trái.</p>}
                  </div>
                )}

                {/* Dòng số tiền chiết khấu — chỉ hiện khi thật sự có áp dụng (discountAmount > 0). */}
                {invoice.discountAmount > 0 && (
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                      Đã chiết khấu{invoice.discountMode === 'TOTAL' && invoice.discountType === 'PERCENT' ? ` (${invoice.discountValue}%)` : ''}
                    </span>
                    <span className="text-sm font-bold tabular-nums text-emerald-700">-{formatVnd(invoice.discountAmount)}</span>
                  </div>
                )}

                {invoice.status === 'UNPAID' && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="discount-reason" className="text-sm font-semibold text-slate-800">
                      Lý do chiết khấu
                    </label>
                    <input
                      id="discount-reason"
                      type="text"
                      value={discountReason}
                      onChange={(e) => setDiscountReason(e.target.value)}
                      placeholder="Bắt buộc trước khi lưu chiết khấu"
                      className="rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    {discountError && <p className="text-xs font-semibold text-rose-600">{discountError}</p>}
                  </div>
                )}

                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Cần thu</span>
                  <span className="text-2xl font-bold tabular-nums text-slate-900">{formatVnd(invoice.dueAmount)}</span>
                </div>
              </div>

              {invoice.status === 'UNPAID' ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-bold text-slate-700">Phương thức thanh toán</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {walletActive && (
                        <button
                          type="button"
                          onClick={() => setMethod('WALLET')}
                          className={`col-span-2 ${methodChipBase} ${method === 'WALLET' ? methodChipSelected : methodChipUnselected}`}
                        >
                          <Wallet size={15} weight="regular" aria-hidden="true" />
                          Trừ ví tạm ứng
                          {method !== 'WALLET' && wallet && <span className="ml-1 text-[11px] font-medium opacity-80">· còn lại {formatVnd(wallet.balance)}</span>}
                        </button>
                      )}
                      {nonWalletMethods.map((item) => {
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
                      <label htmlFor="invoice-cash-received" className="text-sm font-bold text-slate-700">
                        Tiền khách đưa
                      </label>
                      <MoneyInput
                        id="invoice-cash-received"
                        value={cashReceived}
                        onChange={setCashReceived}
                        className="rounded-md border-2 border-slate-300 px-3 py-2 text-right text-base font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
                      />
                      {/* Pill mệnh giá — bấm cộng dồn vào ô trên (chốt qua AskUserQuestion), cộng nút "Vừa đủ" tự điền đúng dueAmount. */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CashTenderPills value={cashReceived ?? 0} onChange={setCashReceived} />
                        <button
                          type="button"
                          onClick={() => setCashReceived(invoice.dueAmount)}
                          className="rounded-full border-2 border-brand-teal bg-brand-teal-tint px-2.5 py-1 text-xs font-bold text-brand-teal hover:bg-brand-teal hover:text-white"
                        >
                          Vừa đủ
                        </button>
                      </div>
                      {changeAmount !== null && changeAmount >= 0 && (
                        <div className="flex items-baseline justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                          <span className="text-xs font-bold text-emerald-700">Tiền trả lại</span>
                          <span className="text-lg font-bold tabular-nums text-emerald-700">{formatVnd(changeAmount)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Ví tạm ứng — số dư không đủ: khối "Cần thu tối thiểu" + 2 nút gợi ý nạp nhanh
                      (Luồng 2 PRD), cộng tuỳ chọn trả hỗn hợp khi tenant đã bật công tắc. */}
                  {method === 'WALLET' && walletShortfall > 0 && (
                    <div className="flex flex-col gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
                        <Warning size={14} weight="fill" aria-hidden="true" />
                        Số dư ví không đủ
                      </div>
                      <div className="flex flex-col gap-1 text-xs">
                        <div className="flex justify-between text-slate-700">
                          <span>Cần thu</span>
                          <span className="tabular-nums">{formatVnd(invoice.dueAmount)}</span>
                        </div>
                        <div className="flex justify-between text-slate-700">
                          <span>Số dư ví</span>
                          <span className="tabular-nums">{formatVnd(wallet?.balance ?? 0)}</span>
                        </div>
                        <div className="flex justify-between border-t border-amber-200 pt-1 text-sm font-bold text-amber-800">
                          <span>Cần thu tối thiểu</span>
                          <span className="tabular-nums">{formatVnd(walletShortfall)}</span>
                        </div>
                      </div>
                      {!useHybrid && (
                        <div className="flex flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => setQuickTopUpAmount(walletShortfall)}
                            disabled={topUpAndPayMutation.isPending}
                            className="flex items-center justify-between gap-2 rounded-md border-2 border-amber-400 bg-amber-100 px-3 py-2.5 text-[13px] font-bold text-amber-900 shadow-sm hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className="flex items-center gap-1.5">
                              <Wallet size={15} weight="fill" aria-hidden="true" />
                              Nạp phần thiếu
                            </span>
                            <span className="text-[15px] font-bold tabular-nums">{formatVnd(walletShortfall)}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuickTopUpAmount(Math.ceil((walletShortfall + 1) / 1_000_000) * 1_000_000)}
                            disabled={topUpAndPayMutation.isPending}
                            className="flex items-center justify-between gap-2 rounded-md border-2 border-amber-400 bg-amber-100 px-3 py-2.5 text-[13px] font-bold text-amber-900 shadow-sm hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className="flex items-center gap-1.5">
                              <Wallet size={15} weight="fill" aria-hidden="true" />
                              Nạp mức chuẩn
                            </span>
                            <span className="text-[15px] font-bold tabular-nums">{formatVnd(Math.ceil((walletShortfall + 1) / 1_000_000) * 1_000_000)}</span>
                          </button>
                          {/* "Nhập số khác" — gõ tay 1 mức tuỳ ý (khác 2 gợi ý cố định ở trên), chủ dự án yêu cầu trực tiếp. */}
                          {customTopUpOpen ? (
                            <div className="flex items-center gap-1.5">
                              <MoneyInput
                                id="invoice-custom-topup"
                                value={customTopUpAmount}
                                onChange={setCustomTopUpAmount}
                                className="min-w-0 flex-1 rounded-md border-2 border-amber-300 bg-white px-2.5 py-2 text-right text-sm font-bold text-amber-900 focus:border-amber-500 focus:outline-none"
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                className="shrink-0 px-2.5 py-2 text-xs"
                                disabled={!customTopUpAmount || customTopUpAmount <= 0}
                                onClick={() => setQuickTopUpAmount(customTopUpAmount!)}
                              >
                                Nạp
                              </Button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setCustomTopUpOpen(true)} className="self-start text-xs font-semibold text-amber-800 underline hover:text-amber-900">
                              Nhập số khác
                            </button>
                          )}
                        </div>
                      )}

                      {mixedPaymentEnabled && (
                        <div className="flex flex-col gap-1.5 border-t border-amber-200 pt-2.5">
                          <button
                            type="button"
                            onClick={() => setUseHybrid((v) => !v)}
                            className={`rounded-md border-2 px-2.5 py-2 text-left text-xs font-bold transition-colors ${
                              useHybrid ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'
                            }`}
                          >
                            Trừ hết ví ({formatVnd(walletCovered)}) + thu phần còn lại ({formatVnd(walletShortfall)})
                          </button>
                          {useHybrid && (
                            <div className="grid grid-cols-2 gap-1.5">
                              {nonWalletMethods.map((item) => (
                                <button
                                  key={item.code}
                                  type="button"
                                  onClick={() => setHybridRemainderMethod(item.code)}
                                  className={`${methodChipBase} ${hybridRemainderMethod === item.code ? methodChipSelected : methodChipUnselected}`}
                                >
                                  {item.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <Button type="button" variant="secondary" onClick={() => void handleSaveDraft()} loading={draftMutation.isPending}>
                      Lưu tạm
                    </Button>
                    {method === 'WALLET' ? (
                      (walletShortfall === 0 || (useHybrid && hybridRemainderMethod !== '')) && (
                        <Button type="button" onClick={() => void handlePayWithWallet()} loading={payWithWalletMutation.isPending}>
                          <Receipt size={16} weight="bold" aria-hidden="true" />
                          Thu tiền &amp; In phiếu
                        </Button>
                      )
                    ) : (
                      <Button
                        type="button"
                        onClick={() => void handlePay()}
                        loading={payMutation.isPending}
                        disabled={method === 'CASH' && changeAmount !== null && changeAmount < 0}
                      >
                        <Receipt size={16} weight="bold" aria-hidden="true" />
                        Thu tiền &amp; In phiếu
                      </Button>
                    )}
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
                      Đã hoàn {formatVnd(invoice.dueAmount)}
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
                  Trả lại <span className="text-sm font-bold text-slate-900">{formatVnd(invoice.dueAmount)}</span> cho khách.
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

      {quickTopUpAmount !== null && invoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="quick-topup-title">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p id="quick-topup-title" className="text-sm font-semibold text-slate-900">
              Nạp tiền &amp; thu ngay?
            </p>
            <p className="mt-1.5 text-xs text-slate-500">Số tiền nạp sẽ trừ ngay vào ví rồi thu luôn phiếu này — không sửa lại được sau khi xác nhận.</p>

            <div className="mt-3 flex items-center gap-3 rounded-md bg-emerald-50/70 py-2.5 pl-2.5 pr-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-emerald-600 text-white">
                <Wallet size={16} weight="fill" aria-hidden="true" />
              </div>
              <p className="text-xs leading-snug text-slate-700">
                Nạp <span className="text-sm font-bold text-slate-900">{formatVnd(quickTopUpAmount)}</span> vào ví, thu đủ{' '}
                <span className="text-sm font-bold text-slate-900">{formatVnd(invoice.dueAmount)}</span> cho phiếu {invoice.invoiceNo}.
              </p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setQuickTopUpAmount(null)} disabled={topUpAndPayMutation.isPending}>
                Huỷ
              </Button>
              <Button
                type="button"
                variant="success"
                loading={topUpAndPayMutation.isPending}
                onClick={async () => {
                  const ok = await handlePayWithWallet(quickTopUpAmount);
                  if (ok) {
                    setQuickTopUpAmount(null);
                    setCustomTopUpOpen(false);
                    setCustomTopUpAmount(undefined);
                  }
                }}
              >
                Xác nhận nạp &amp; thu
              </Button>
            </div>
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
