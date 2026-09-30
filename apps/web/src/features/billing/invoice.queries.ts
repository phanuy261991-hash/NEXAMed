import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApplyInvoiceDiscountRequest,
  MarkInvoicePaidRequest,
  PayInvoiceWithWalletRequest,
  RefundInvoiceItemsRequest,
  RefundInvoiceRequest,
  RevertInvoicePaymentRequest,
  SaveInvoiceDraftRequest,
  TopUpAndPayInvoiceWithWalletRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  applyInvoiceDiscount,
  getBillingInvoice,
  getBillingInvoiceList,
  markInvoicePaid,
  payInvoiceWithWallet,
  printCombinedInvoices,
  printInvoice,
  refundInvoice,
  refundInvoiceItems,
  revertInvoicePayment,
  saveInvoiceDraft,
  topUpAndPayInvoiceWithWallet,
} from './invoice.api';

/** "Thu ngân" (danh sách trong ngày) + tổng kết cuối ngày (BIL-04) — 1 ngày/tenant nhỏ, không cursor. */
export function useBillingInvoiceListQuery(date?: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'invoice', 'list', date),
    queryFn: () => getBillingInvoiceList(date),
    refetchInterval: 30_000,
  });
}

/** `invoiceId` tuỳ chọn (Kho Thuốc GĐ3, #165) — mở đúng hoá đơn đó thay vì mặc định hoá đơn SERVICE. */
export function useBillingInvoiceQuery(encounterId: string, invoiceId?: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'invoice', 'detail', encounterId, invoiceId ?? ''),
    queryFn: () => getBillingInvoice(encounterId, invoiceId),
    enabled: enabled && encounterId !== '',
  });
}

function useInvalidateInvoice() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'invoice') });
}

export function useMarkInvoicePaidMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (body: MarkInvoicePaidRequest) => markInvoicePaid(encounterId, body),
    // Thu tiền xong có thể mở khoá "Hàng đợi khám" ngay (gate theo thanh toán) — làm mới cả
    // 'reception' để bác sĩ thấy đúng, không cần F5 thủ công.
    onSuccess: () => {
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'reception') });
    },
  });
}

/** Ví tạm ứng — trừ số dư ví HIỆN CÓ. Cùng invalidate 'reception' như `useMarkInvoicePaidMutation` (mở khoá "Hàng đợi khám" ngay). */
export function usePayInvoiceWithWalletMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (body: PayInvoiceWithWalletRequest) => payInvoiceWithWallet(encounterId, body),
    onSuccess: () => {
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'reception') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'wallet') });
    },
  });
}

/** Ví tạm ứng — nạp thêm rồi trừ ngay (Luồng "Nạp phần thiếu"/"Nạp mức chuẩn"). */
export function useTopUpAndPayInvoiceWithWalletMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (body: TopUpAndPayInvoiceWithWalletRequest) => topUpAndPayInvoiceWithWallet(encounterId, body),
    onSuccess: () => {
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'reception') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'wallet') });
    },
  });
}

export function useRevertInvoicePaymentMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (body: RevertInvoicePaymentRequest) => revertInvoicePayment(encounterId, body),
    onSuccess: () => {
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'reception') });
    },
  });
}

/** #085 — hoàn tiền cho lượt khám đã huỷ. Nút chỉ hiện với vai trò có `invoice.refund` (mặc định chỉ `clinic_admin`). */
export function useRefundInvoiceMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (body: RefundInvoiceRequest) => refundInvoice(encounterId, body),
    onSuccess: () => {
      void invalidate();
      // Tổng kết cuối ngày đổi (paidTotalAmount/refundedTotalAmount/netTotalAmount) — làm mới luôn.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'invoice', 'list') });
    },
  });
}

/** #203 — hoàn tiền MỘT PHẦN theo dòng thuốc. Nút chỉ hiện với vai trò có `invoice.refund_drug` (mặc
 * định lễ tân + quản trị). Làm mới cả tổng kết ngày (refundedAmount trong 'invoice','list') và
 * 'stock-balance'/'stock-receipt' (restock=true tự sinh phiếu nhập RETURN_FROM_USE). */
export function useRefundInvoiceItemsMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (body: RefundInvoiceItemsRequest) => refundInvoiceItems(encounterId, body),
    onSuccess: () => {
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'invoice', 'list') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-balance') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-receipt') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-ledger') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'wallet') });
    },
  });
}

/** Chiết khấu — thay đổi `dueAmount` nên phải làm mới cả tổng kết ngày ('invoice','list'), không chỉ chi tiết. */
export function useApplyInvoiceDiscountMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (body: ApplyInvoiceDiscountRequest) => applyInvoiceDiscount(encounterId, body),
    onSuccess: () => {
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'invoice', 'list') });
    },
  });
}

export function useSaveInvoiceDraftMutation(encounterId: string) {
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (body: SaveInvoiceDraftRequest) => saveInvoiceDraft(encounterId, body),
    onSuccess: () => void invalidate(),
  });
}

/** In gộp — server đánh dấu đã in cho MỌI phiếu trong bản in nên làm mới cả chi tiết lẫn danh sách. */
export function usePrintCombinedInvoicesMutation(encounterId: string) {
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: () => printCombinedInvoices(encounterId),
    onSuccess: () => void invalidate(),
  });
}

export function usePrintInvoiceMutation(encounterId: string, invoiceId?: string) {
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: () => printInvoice(encounterId, invoiceId),
    onSuccess: () => void invalidate(),
  });
}
