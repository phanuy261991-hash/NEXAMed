import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveCashVoucherRequest,
  CreateCashVoucherRequest,
  ListCashVouchersQuery,
  RejectCashVoucherRequest,
  UpdateCashVoucherRequest,
  VoidCashVoucherRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  approveCashVoucher,
  createCashVoucher,
  getCashVoucher,
  getCashVouchers,
  printCashVoucher,
  rejectCashVoucher,
  updateCashVoucher,
  voidCashVoucher,
} from './cash-voucher.api';

export function useCashVouchersQuery(query: ListCashVouchersQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'cash-voucher', 'list', JSON.stringify(query)),
    queryFn: () => getCashVouchers(query),
  });
}

export function useCashVoucherQuery(id: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'cash-voucher', 'detail', id),
    queryFn: () => getCashVoucher(id),
    enabled: enabled && id !== '',
  });
}

/** Phiếu thu/chi cộng/trừ thẳng vào "Tiền mặt dự kiến trong két" — làm mới luôn `cashier-shift`
 * (summary bước 1 wizard Chốt ca đọc SỐNG) để không cần F5 thủ công, cùng cách `invoice.queries.ts`. */
function useInvalidateCashVoucher() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'cash-voucher') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'cashier-shift') });
  };
}

export function useCreateCashVoucherMutation() {
  const invalidate = useInvalidateCashVoucher();
  return useMutation({
    mutationFn: (body: CreateCashVoucherRequest) => createCashVoucher(body),
    onSuccess: invalidate,
  });
}

export function useUpdateCashVoucherMutation() {
  const invalidate = useInvalidateCashVoucher();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCashVoucherRequest }) => updateCashVoucher(id, body),
    onSuccess: invalidate,
  });
}

export function useVoidCashVoucherMutation() {
  const invalidate = useInvalidateCashVoucher();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: VoidCashVoucherRequest }) => voidCashVoucher(id, body),
    onSuccess: invalidate,
  });
}

export function useApproveCashVoucherMutation() {
  const invalidate = useInvalidateCashVoucher();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApproveCashVoucherRequest }) => approveCashVoucher(id, body),
    onSuccess: invalidate,
  });
}

export function useRejectCashVoucherMutation() {
  const invalidate = useInvalidateCashVoucher();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RejectCashVoucherRequest }) => rejectCashVoucher(id, body),
    onSuccess: invalidate,
  });
}

export function usePrintCashVoucherMutation() {
  const invalidate = useInvalidateCashVoucher();
  return useMutation({
    mutationFn: (id: string) => printCashVoucher(id),
    onSuccess: invalidate,
  });
}
