import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveCashierShiftRequest,
  CloseCashierShiftRequest,
  EditCashierShiftRequest,
  ListCashierShiftsQuery,
  OpenCashierShiftRequest,
  ResolveCashierShiftDiscrepancyRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  approveCashierShift,
  closeCashierShift,
  editCashierShift,
  getCashierShiftBlindCloseEnabled,
  getCashierShiftDetail,
  getCashierShiftList,
  getCashierShiftResyncPreview,
  getCashierShiftSummary,
  getCurrentCashierShift,
  openCashierShift,
  resolveCashierShiftDiscrepancy,
} from './cashier-shift.api';

export function useCurrentCashierShiftQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'cashier-shift', 'current'),
    queryFn: getCurrentCashierShift,
  });
}

function useInvalidateCashierShift() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'cashier-shift') });
}

export function useOpenCashierShiftMutation() {
  const invalidate = useInvalidateCashierShift();
  return useMutation({
    mutationFn: (body: OpenCashierShiftRequest) => openCashierShift(body),
    onSuccess: () => void invalidate(),
  });
}

export function useCashierShiftSummaryQuery(id: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'cashier-shift', 'summary', id),
    queryFn: () => getCashierShiftSummary(id),
    enabled: enabled && id !== '',
    // Sát bước 1 wizard Chốt ca — số liệu đổi theo phiếu thu phát sinh trong ca, làm mới đều đặn.
    refetchInterval: 15_000,
  });
}

export function useCloseCashierShiftMutation(id: string) {
  const invalidate = useInvalidateCashierShift();
  return useMutation({
    mutationFn: (body: CloseCashierShiftRequest) => closeCashierShift(id, body),
    onSuccess: () => void invalidate(),
  });
}

export function useCashierShiftListQuery(query: ListCashierShiftsQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'cashier-shift', 'list', query),
    queryFn: () => getCashierShiftList(query),
  });
}

export function useCashierShiftDetailQuery(id: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'cashier-shift', 'detail', id),
    queryFn: () => getCashierShiftDetail(id),
    enabled: enabled && id !== '',
  });
}

/** "Tính toán lại" (đọc-only, chưa lưu) — dùng `useMutation` dù bản chất là GET, vì actor chủ động bấm nút, không tự tải. */
export function useCashierShiftResyncPreviewMutation() {
  return useMutation({ mutationFn: (id: string) => getCashierShiftResyncPreview(id) });
}

export function useResolveCashierShiftDiscrepancyMutation(id: string) {
  const invalidate = useInvalidateCashierShift();
  return useMutation({
    mutationFn: (body: ResolveCashierShiftDiscrepancyRequest) => resolveCashierShiftDiscrepancy(id, body),
    onSuccess: () => void invalidate(),
  });
}

export function useApproveCashierShiftMutation(id: string) {
  const invalidate = useInvalidateCashierShift();
  return useMutation({
    mutationFn: (body: ApproveCashierShiftRequest) => approveCashierShift(id, body),
    onSuccess: () => void invalidate(),
  });
}

export function useEditCashierShiftMutation(id: string) {
  const invalidate = useInvalidateCashierShift();
  return useMutation({
    mutationFn: (body: EditCashierShiftRequest) => editCashierShift(id, body),
    onSuccess: () => void invalidate(),
  });
}

export function useCashierShiftBlindCloseEnabledQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'cashier-shift', 'blind-close-enabled'),
    queryFn: getCashierShiftBlindCloseEnabled,
  });
}
