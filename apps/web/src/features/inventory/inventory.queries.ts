import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveStockCountRequest,
  ApproveStockReceiptRequest,
  CreateStockCountRequest,
  CreateStockIssueRequest,
  CreateStockReceiptRequest,
  CreateStockTransferRequest,
  ListDispenseQueueQuery,
  ListStockBalancesQuery,
  ListStockCountsQuery,
  ListStockIssuesQuery,
  ListStockReceiptsQuery,
  ListStockTransfersQuery,
  ReceiveStockTransferRequest,
  RejectStockCountRequest,
  RejectStockReceiptRequest,
  RejectStockTransferRequest,
  ShipStockTransferRequest,
  UpdateStockCountRequest,
  UpdateStockReceiptRequest,
  UpdateStockTransferRequest,
  VoidStockIssueRequest,
  VoidStockReceiptRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  approveStockCount,
  approveStockReceipt,
  createStockCount,
  createStockIssue,
  createStockReceipt,
  createStockTransfer,
  getDispenseQueue,
  getDrugBatchBalances,
  getDrugLedger,
  getPrescriptionDispenseStatus,
  getStockBalances,
  getStockCount,
  getStockCounts,
  getStockExpiryWarnings,
  getStockIssue,
  getStockIssues,
  getStockReceipt,
  getStockReceipts,
  getStockTransfer,
  getStockTransfers,
  receiveStockTransfer,
  rejectStockCount,
  rejectStockReceipt,
  rejectStockTransfer,
  shipStockTransfer,
  updateStockCount,
  updateStockReceipt,
  updateStockTransfer,
  voidStockIssue,
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

// ============ Kho Thuốc GĐ3 — "Phiếu xuất kho" / "Phát thuốc" (docs/DECISIONS.md #163) ============

export function useStockIssuesQuery(query: ListStockIssuesQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-issue', 'list', JSON.stringify(query)),
    queryFn: () => getStockIssues(query),
  });
}

export function useStockIssueQuery(id: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-issue', 'detail', id),
    queryFn: () => getStockIssue(id),
    enabled: enabled && id !== '',
  });
}

export function usePrescriptionDispenseStatusQuery(prescriptionId: string, warehouseId?: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'dispense-status', prescriptionId, warehouseId ?? ''),
    queryFn: () => getPrescriptionDispenseStatus(prescriptionId, warehouseId),
    enabled: enabled && prescriptionId !== '',
  });
}

export function useDispenseQueueQuery(query: ListDispenseQueueQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'dispense-queue', JSON.stringify(query)),
    queryFn: () => getDispenseQueue(query),
  });
}

/** Đúng khuôn `useInvalidateInventory()` ở trên — thêm invalidate `invoice`/`dispense-status`/
 * `dispense-queue` (Phiếu xuất kho gắn tiền vào hoá đơn + đổi trạng thái phát của đơn thuốc). */
function useInvalidateAfterDispense() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-issue') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-balance') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-ledger') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'dispense-status') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'dispense-queue') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'invoice') });
  };
}

export function useCreateStockIssueMutation() {
  const invalidate = useInvalidateAfterDispense();
  return useMutation({
    mutationFn: (body: CreateStockIssueRequest) => createStockIssue(body),
    onSuccess: invalidate,
  });
}

export function useVoidStockIssueMutation() {
  const invalidate = useInvalidateAfterDispense();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: VoidStockIssueRequest }) => voidStockIssue(id, body),
    onSuccess: invalidate,
  });
}

// ============ Kho Thuốc GĐ4 — "Kiểm kê" (docs/DECISIONS.md #170) ============

export function useStockCountsQuery(query: ListStockCountsQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-count', 'list', JSON.stringify(query)),
    queryFn: () => getStockCounts(query),
  });
}

export function useStockCountQuery(id: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-count', 'detail', id),
    queryFn: () => getStockCount(id),
    enabled: enabled && id !== '',
  });
}

/** Duyệt Kiểm kê có thể tự sinh phiếu nhập/xuất kho + đụng tồn kho/thẻ kho — invalidate đủ cả 4
 * khoá cache liên quan, đúng khuôn `useInvalidateInventory()`. */
function useInvalidateAfterCount() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-count') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-receipt') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-issue') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-balance') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-ledger') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-expiry') });
  };
}

export function useCreateStockCountMutation() {
  const invalidate = useInvalidateAfterCount();
  return useMutation({
    mutationFn: (body: CreateStockCountRequest) => createStockCount(body),
    onSuccess: invalidate,
  });
}

export function useUpdateStockCountMutation() {
  const invalidate = useInvalidateAfterCount();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStockCountRequest }) => updateStockCount(id, body),
    onSuccess: invalidate,
  });
}

export function useApproveStockCountMutation() {
  const invalidate = useInvalidateAfterCount();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApproveStockCountRequest }) => approveStockCount(id, body),
    onSuccess: invalidate,
  });
}

export function useRejectStockCountMutation() {
  const invalidate = useInvalidateAfterCount();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RejectStockCountRequest }) => rejectStockCount(id, body),
    onSuccess: invalidate,
  });
}

// ============ Kho Thuốc GĐ4 — "Điều chuyển kho" (docs/DECISIONS.md #170) ============

export function useStockTransfersQuery(query: ListStockTransfersQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-transfer', 'list', JSON.stringify(query)),
    queryFn: () => getStockTransfers(query),
  });
}

export function useStockTransferQuery(id: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'stock-transfer', 'detail', id),
    queryFn: () => getStockTransfer(id),
    enabled: enabled && id !== '',
  });
}

/** Duyệt xuất/Xác nhận nhận hàng đụng tồn kho CẢ 2 kho + tự sinh phiếu nhập/xuất — invalidate đủ
 * mọi khoá cache liên quan, đúng khuôn `useInvalidateAfterCount()`. */
function useInvalidateAfterTransfer() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-transfer') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-receipt') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-issue') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-balance') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-ledger') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'stock-expiry') });
  };
}

export function useCreateStockTransferMutation() {
  const invalidate = useInvalidateAfterTransfer();
  return useMutation({
    mutationFn: (body: CreateStockTransferRequest) => createStockTransfer(body),
    onSuccess: invalidate,
  });
}

export function useUpdateStockTransferMutation() {
  const invalidate = useInvalidateAfterTransfer();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStockTransferRequest }) => updateStockTransfer(id, body),
    onSuccess: invalidate,
  });
}

export function useShipStockTransferMutation() {
  const invalidate = useInvalidateAfterTransfer();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ShipStockTransferRequest }) => shipStockTransfer(id, body),
    onSuccess: invalidate,
  });
}

export function useRejectStockTransferMutation() {
  const invalidate = useInvalidateAfterTransfer();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RejectStockTransferRequest }) => rejectStockTransfer(id, body),
    onSuccess: invalidate,
  });
}

export function useReceiveStockTransferMutation() {
  const invalidate = useInvalidateAfterTransfer();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReceiveStockTransferRequest }) => receiveStockTransfer(id, body),
    onSuccess: invalidate,
  });
}
