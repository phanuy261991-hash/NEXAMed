import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MarkInvoicePaidRequest, RevertInvoicePaymentRequest, SaveInvoiceDraftRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getBillingInvoice, getBillingInvoiceList, markInvoicePaid, printInvoice, revertInvoicePayment, saveInvoiceDraft } from './invoice.api';

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
