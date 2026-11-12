import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddStockRequestLinesRequest,
  AllocateStockRequestRequest,
  CancelStockRequestRequest,
  CreateStockRequestRequest,
  EscalateStockRequestRequest,
  ListStockRequestsQuery,
  RejectStockRequestRequest,
  UpdateStockRequestNoteRequest,
  UpdateStockRequestRequest,
  VersionedStockRequestRequest,
  WithdrawStockRequestLinesRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  acceptStockRequest,
  acknowledgeStockRequestUpdate,
  addStockRequestLines,
  allocateStockRequest,
  cancelStockRequest,
  createStockRequest,
  escalateStockRequest,
  exportStockRequests,
  getStockRequest,
  getStockRequestLowStock,
  getStockRequestOptions,
  getStockRequestPendingCounts,
  getStockRequests,
  noteStockRequest,
  rejectStockRequest,
  submitStockRequest,
  updateStockRequest,
  withdrawStockRequestLines,
} from './stock-request.api';

// Hook cho "Yêu cầu cấp hàng" (docs/DECISIONS.md #298).

export function useStockRequestsQuery(query: ListStockRequestsQuery, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-request', 'list', JSON.stringify(query)),
    queryFn: () => getStockRequests(query),
    enabled,
  });
}

export function useStockRequestQuery(id: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-request', 'detail', id),
    queryFn: () => getStockRequest(id),
    enabled: enabled && id !== '',
  });
}

export function useStockRequestPendingCountsQuery(enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-request', 'pending-counts'),
    queryFn: getStockRequestPendingCounts,
    enabled,
    refetchInterval: 60_000,
  });
}

export function useStockRequestOptionsQuery(enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'stock-request', 'options'), queryFn: getStockRequestOptions, enabled });
}

export function useStockRequestLowStockQuery(warehouseId: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-request', 'low-stock', warehouseId),
    queryFn: () => getStockRequestLowStock(warehouseId),
    enabled: warehouseId !== '',
  });
}

/** Cấp hàng sinh phiếu điều chuyển nháp và đổi số liệu bên xin/bên cấp — làm mới cả hai nhóm cache. */
function useInvalidateAfterRequest() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-request') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-transfer') });
  };
}

export function useCreateStockRequestMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: (body: CreateStockRequestRequest) => createStockRequest(body), onSuccess: invalidate });
}

export function useUpdateStockRequestMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: UpdateStockRequestRequest }) => updateStockRequest(id, body), onSuccess: invalidate });
}

export function useSubmitStockRequestMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: VersionedStockRequestRequest }) => submitStockRequest(id, body), onSuccess: invalidate });
}

export function useCancelStockRequestMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: CancelStockRequestRequest }) => cancelStockRequest(id, body), onSuccess: invalidate });
}

export function useNoteStockRequestMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: UpdateStockRequestNoteRequest }) => noteStockRequest(id, body), onSuccess: invalidate });
}

export function useAddStockRequestLinesMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: AddStockRequestLinesRequest }) => addStockRequestLines(id, body), onSuccess: invalidate });
}

export function useWithdrawStockRequestLinesMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: WithdrawStockRequestLinesRequest }) => withdrawStockRequestLines(id, body), onSuccess: invalidate });
}

export function useAcceptStockRequestMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: VersionedStockRequestRequest }) => acceptStockRequest(id, body), onSuccess: invalidate });
}

export function useRejectStockRequestMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: RejectStockRequestRequest }) => rejectStockRequest(id, body), onSuccess: invalidate });
}

export function useAcknowledgeStockRequestUpdateMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: (id: string) => acknowledgeStockRequestUpdate(id), onSuccess: invalidate });
}

export function useAllocateStockRequestMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: AllocateStockRequestRequest }) => allocateStockRequest(id, body), onSuccess: invalidate });
}

export function useEscalateStockRequestMutation() {
  const invalidate = useInvalidateAfterRequest();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: EscalateStockRequestRequest }) => escalateStockRequest(id, body), onSuccess: invalidate });
}

export function useExportStockRequestsMutation() {
  return useMutation({ mutationFn: (query: ListStockRequestsQuery) => exportStockRequests(query) });
}
