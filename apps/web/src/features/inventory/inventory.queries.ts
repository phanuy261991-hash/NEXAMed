import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveStockReceiptRequest,
  CreateStockReceiptRequest,
  ListStockBalancesQuery,
  ListStockReceiptsQuery,
  RejectStockReceiptRequest,
  UpdateStockReceiptRequest,
  VoidStockReceiptRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  approveStockReceipt,
  createStockReceipt,
  getDrugBatchBalances,
  getDrugLedger,
  getStockBalances,
  getStockExpiryWarnings,
  getStockReceipt,
  getStockReceipts,
  rejectStockReceipt,
  updateStockReceipt,
  voidStockReceipt,
} from './inventory.api';

export function useStockReceiptsQuery(query: ListStockReceiptsQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-receipt', 'list', JSON.stringify(query)),
    queryFn: () => getStockReceipts(query),
  });
}

export function useStockReceiptQuery(id: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-receipt', 'detail', id),
    queryFn: () => getStockReceipt(id),
    enabled: enabled && id !== '',
  });
}

function useInvalidateInventory() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-receipt') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-balance') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-ledger') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-expiry') });
    // Duyệt phiếu PURCHASE cập nhật cache "giá nhập gần nhất" trên chính `drug`.
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'drug') });
  };
}

export function useCreateStockReceiptMutation() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (body: CreateStockReceiptRequest) => createStockReceipt(body),
    onSuccess: invalidate,
  });
}

export function useUpdateStockReceiptMutation() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStockReceiptRequest }) => updateStockReceipt(id, body),
    onSuccess: invalidate,
  });
}

export function useApproveStockReceiptMutation() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApproveStockReceiptRequest }) => approveStockReceipt(id, body),
    onSuccess: invalidate,
  });
}

export function useRejectStockReceiptMutation() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RejectStockReceiptRequest }) => rejectStockReceipt(id, body),
    onSuccess: invalidate,
  });
}

export function useVoidStockReceiptMutation() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: VoidStockReceiptRequest }) => voidStockReceipt(id, body),
    onSuccess: invalidate,
  });
}

export function useStockBalancesQuery(query: ListStockBalancesQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-balance', 'list', JSON.stringify(query)),
    queryFn: () => getStockBalances(query),
  });
}

export function useDrugBatchBalancesQuery(drugId: string, warehouseId?: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-balance', 'by-drug', drugId, warehouseId ?? ''),
    queryFn: () => getDrugBatchBalances(drugId, warehouseId),
    enabled: enabled && drugId !== '',
  });
}

export function useDrugLedgerQuery(drugId: string, params: { warehouseId?: string; limit?: number } = {}, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-ledger', drugId, JSON.stringify(params)),
    queryFn: () => getDrugLedger(drugId, params),
    enabled: enabled && drugId !== '',
  });
}

export function useStockExpiryWarningsQuery(warehouseId?: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-expiry', warehouseId ?? ''),
    queryFn: () => getStockExpiryWarnings(warehouseId),
  });
}
