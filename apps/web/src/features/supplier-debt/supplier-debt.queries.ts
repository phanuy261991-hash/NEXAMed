import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListSupplierDebtLedgerQuery, RecordSupplierDebtOpeningBalanceRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getSupplierDebtSummary, listSupplierDebtLedger, listSupplierDebtReceipts, listSupplierDebtSummaries, recordSupplierDebtOpeningBalance } from './supplier-debt.api';

export function useSupplierDebtSummariesQuery(includeInactive: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier-debt-summaries', includeInactive ? 'all' : 'active'),
    queryFn: () => listSupplierDebtSummaries(includeInactive),
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
