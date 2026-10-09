import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcceptShiftSwapRequest, CancelShiftSwapRequest, CreateShiftSwapRequest, DeclineShiftSwapRequest, ShiftSwapStatus } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  acceptShiftSwap,
  cancelShiftSwap,
  checkShiftSwapAssignment,
  createShiftSwap,
  declineShiftSwap,
  getShiftSwapIncomingCount,
  getShiftSwapUnseenCount,
  listShiftSwapColleagueAssignments,
  listShiftSwapColleagues,
  listShiftSwaps,
  markShiftSwapsSeen,
} from './shift-swap.api';

/** Chấm số/yêu cầu chờ — cùng nhịp 30 giây với các chấm số khác ở Sidebar. */
const COUNT_REFETCH_MS = 30_000;

export function useShiftSwapsQuery(filter: { status?: ShiftSwapStatus } = {}, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'shift-swap', 'list', filter.status),
    queryFn: () => listShiftSwaps(filter),
    enabled,
  });
}

/** Số yêu cầu đang chờ MÌNH xác nhận. */
export function useShiftSwapIncomingCountQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'shift-swap', 'incoming-count'),
    queryFn: getShiftSwapIncomingCount,
    enabled,
    refetchInterval: COUNT_REFETCH_MS,
  });
}

/** Số yêu cầu đổi ca MỚI chưa xem (quản lý, scope global). */
export function useShiftSwapUnseenCountQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'shift-swap', 'unseen-count'),
    queryFn: getShiftSwapUnseenCount,
    enabled,
    refetchInterval: COUNT_REFETCH_MS,
  });
}

export function useShiftSwapColleaguesQuery(enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'shift-swap', 'colleagues'), queryFn: listShiftSwapColleagues, enabled });
}

export function useShiftSwapColleagueAssignmentsQuery(userId: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'shift-swap', 'colleague-assignments', userId),
    queryFn: () => listShiftSwapColleagueAssignments(userId),
    enabled: userId !== '',
  });
}

export function useShiftSwapAssignmentCheckQuery(assignmentId: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'shift-swap', 'check', assignmentId),
    queryFn: () => checkShiftSwapAssignment(assignmentId),
    enabled: assignmentId !== '',
  });
}

/** Mọi thao tác đổi ca làm mới danh sách yêu cầu, chấm số VÀ lịch ca (xác nhận xong 2 ca đổi chủ). */
function useInvalidateSwap() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'shift-swap') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'work-shift-assignment') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'appointment') });
  };
}

export function useCreateShiftSwapMutation() {
  const invalidate = useInvalidateSwap();
  return useMutation({ mutationFn: (body: CreateShiftSwapRequest) => createShiftSwap(body), onSuccess: invalidate });
}

export function useAcceptShiftSwapMutation() {
  const invalidate = useInvalidateSwap();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string } & AcceptShiftSwapRequest) => acceptShiftSwap(id, body), onSuccess: invalidate });
}

export function useDeclineShiftSwapMutation() {
  const invalidate = useInvalidateSwap();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string } & DeclineShiftSwapRequest) => declineShiftSwap(id, body), onSuccess: invalidate });
}

export function useCancelShiftSwapMutation() {
  const invalidate = useInvalidateSwap();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string } & CancelShiftSwapRequest) => cancelShiftSwap(id, body), onSuccess: invalidate });
}

export function useMarkShiftSwapsSeenMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markShiftSwapsSeen,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'shift-swap', 'unseen-count') });
    },
  });
}
