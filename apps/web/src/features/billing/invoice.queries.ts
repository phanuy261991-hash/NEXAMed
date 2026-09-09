import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApplyInvoiceDiscountRequest,
  MarkInvoicePaidRequest,
  PayInvoiceWithWalletRequest,
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
  printInvoice,
  refundInvoice,
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

export function useBillingInvoiceQuery(encounterId: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'invoice', 'detail', encounterId),
    queryFn: () => getBillingInvoice(encounterId),
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

export function usePrintInvoiceMutation(encounterId: string) {
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: () => printInvoice(encounterId),
    onSuccess: () => void invalidate(),
  });
}
