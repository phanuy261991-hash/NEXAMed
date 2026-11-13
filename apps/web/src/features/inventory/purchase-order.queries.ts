import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CancelPurchaseOrderRequest,
  ClosePurchaseOrderRequest,
  CreatePurchaseOrderRequest,
  ListPurchaseOrdersQuery,
  RejectPurchaseOrderRequest,
  ResolveStockRequestWithdrawRequest,
  UpdatePurchaseOrderRequest,
  VersionedPurchaseOrderRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  exportPurchaseOrders,
  getPurchaseOrder,
  getPurchaseOrderOptions,
  getPurchaseOrderPendingCounts,
  getPurchaseOrders,
  orderPurchaseOrder,
  rejectPurchaseOrder,
  resolveStockRequestWithdrawRequests,
  submitPurchaseOrder,
  updatePurchaseOrder,
} from './purchase-order.api';

// Hook cho "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 giai đoạn 2).

export function usePurchaseOrdersQuery(query: ListPurchaseOrdersQuery, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'purchase-order', 'list', JSON.stringify(query)),
    queryFn: () => getPurchaseOrders(query),
    enabled,
  });
}

export function usePurchaseOrderQuery(id: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'purchase-order', 'detail', id),
    queryFn: () => getPurchaseOrder(id),
    enabled: enabled && id !== '',
  });
}

export function usePurchaseOrderPendingCountsQuery(enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'purchase-order', 'pending-counts'),
    queryFn: getPurchaseOrderPendingCounts,
    enabled,
    refetchInterval: 60_000,
  });
}

export function usePurchaseOrderOptionsQuery(enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'purchase-order', 'options'), queryFn: getPurchaseOrderOptions, enabled });
}

/** Mọi thao tác trên đơn đổi cả danh sách, chấm số, yêu cầu cấp hàng đang chờ đơn và Phiếu nhập kho liên kết — làm mới các nhóm cache đó. */
function useInvalidateAfterOrder() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'purchase-order') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-request') });
  };
}

export function useCreatePurchaseOrderMutation() {
  const invalidate = useInvalidateAfterOrder();
  return useMutation({ mutationFn: (body: CreatePurchaseOrderRequest) => createPurchaseOrder(body), onSuccess: invalidate });
}

export function useUpdatePurchaseOrderMutation() {
  const invalidate = useInvalidateAfterOrder();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: UpdatePurchaseOrderRequest }) => updatePurchaseOrder(id, body), onSuccess: invalidate });
}

export function useSubmitPurchaseOrderMutation() {
  const invalidate = useInvalidateAfterOrder();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: VersionedPurchaseOrderRequest }) => submitPurchaseOrder(id, body), onSuccess: invalidate });
}

export function useApprovePurchaseOrderMutation() {
  const invalidate = useInvalidateAfterOrder();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: VersionedPurchaseOrderRequest }) => approvePurchaseOrder(id, body), onSuccess: invalidate });
}

export function useRejectPurchaseOrderMutation() {
  const invalidate = useInvalidateAfterOrder();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: RejectPurchaseOrderRequest }) => rejectPurchaseOrder(id, body), onSuccess: invalidate });
}

export function useOrderPurchaseOrderMutation() {
  const invalidate = useInvalidateAfterOrder();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: VersionedPurchaseOrderRequest }) => orderPurchaseOrder(id, body), onSuccess: invalidate });
}

export function useClosePurchaseOrderMutation() {
  const invalidate = useInvalidateAfterOrder();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: ClosePurchaseOrderRequest }) => closePurchaseOrder(id, body), onSuccess: invalidate });
}

export function useCancelPurchaseOrderMutation() {
  const invalidate = useInvalidateAfterOrder();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: CancelPurchaseOrderRequest }) => cancelPurchaseOrder(id, body), onSuccess: invalidate });
}

export function useExportPurchaseOrdersMutation() {
  return useMutation({ mutationFn: (query: ListPurchaseOrdersQuery) => exportPurchaseOrders(query) });
}

export function useResolveWithdrawRequestsMutation() {
  const invalidate = useInvalidateAfterOrder();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: ResolveStockRequestWithdrawRequest }) => resolveStockRequestWithdrawRequests(id, body), onSuccess: invalidate });
}
