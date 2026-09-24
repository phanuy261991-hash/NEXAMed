import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListSupplierDebtLedgerQuery, ListSupplierDebtPaymentsQuery, RecordSupplierDebtOpeningBalanceRequest, RecordSupplierDebtPaymentRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  getSupplierDebtSummary,
  listSupplierDebtLedger,
  listSupplierDebtPayments,
  listSupplierDebtReceipts,
  listSupplierDebtSummaries,
  recordSupplierDebtOpeningBalance,
  recordSupplierDebtPayment,
} from './supplier-debt.api';

/** `enabled` mặc định `true` — Sidebar (badge chờ duyệt "Công nợ nhà cung cấp") truyền `false` cho
 * ai không có `supplier_debt.read` để tránh gọi API thừa/403 (đúng khuôn `useSupplierDebtSummaryQuery`). */
export function useSupplierDebtSummariesQuery(includeInactive: boolean, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-summaries', includeInactive ? 'all' : 'active'),
    queryFn: () => listSupplierDebtSummaries(includeInactive),
    enabled,
  });
}

export function useSupplierDebtSummaryQuery(supplierId: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-summary', supplierId),
    queryFn: () => getSupplierDebtSummary(supplierId),
    enabled: enabled && Boolean(supplierId),
  });
}

export function useSupplierDebtLedgerQuery(supplierId: string, query: ListSupplierDebtLedgerQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-ledger', supplierId, query.from ?? '', query.to ?? ''),
    queryFn: () => listSupplierDebtLedger(supplierId, query),
  });
}

export function useSupplierDebtReceiptsQuery(supplierId: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-receipts', supplierId),
    queryFn: () => listSupplierDebtReceipts(supplierId),
  });
}

/** Sau Khai nợ đầu kỳ: làm mới CẢ dữ liệu công nợ (summary/ledger/receipts của đúng NCC này) LẪN
 * danh sách tổng hợp (cột "Còn nợ" ở trang Nhà cung cấp/Công nợ nhà cung cấp). */
export function useRecordSupplierDebtOpeningBalanceMutation(supplierId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordSupplierDebtOpeningBalanceRequest) => recordSupplierDebtOpeningBalance(supplierId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summary', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-ledger', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-receipts', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summaries') });
    },
  });
}

export function useSupplierDebtPaymentsQuery(query: ListSupplierDebtPaymentsQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-payments', query.supplierId ?? '', query.from ?? '', query.to ?? '', query.status ?? ''),
    queryFn: () => listSupplierDebtPayments(query),
  });
}

/** Phần B — "Thanh toán công nợ" trên TỔNG nợ. Sau khi lập: làm mới đúng CẢ 4 nhóm dữ liệu bị ảnh
 * hưởng — số dư NCC (summary/ledger/receipts/summaries, đúng khuôn Khai nợ đầu kỳ ở trên) LẪN danh
 * sách "Phiếu thanh toán NCC" (badge chờ duyệt ở Sidebar cũng đọc từ `supplier-debt-summaries`). */
export function useRecordSupplierDebtPaymentMutation(supplierId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordSupplierDebtPaymentRequest) => recordSupplierDebtPayment(supplierId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summary', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-ledger', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-receipts', supplierId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-summaries') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt-payments') });
    },
  });
}
