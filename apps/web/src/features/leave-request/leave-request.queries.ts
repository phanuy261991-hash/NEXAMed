import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveLeaveRequestRequest,
  CancelLeaveRequestRequest,
  CreateLeaveRequestOnBehalfRequest,
  CreateLeaveRequestRequest,
  LeaveRequestStatus,
  RejectLeaveRequestRequest,
  WithdrawLeaveRequestRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  approveLeaveRequest,
  cancelLeaveRequest,
  createLeaveRequest,
  createLeaveRequestOnBehalf,
  getLeaveRequestAffectedAppointments,
  getLeaveRequestMyImpact,
  getLeaveRequestPendingCount,
  listLeaveRequests,
  rejectLeaveRequest,
  withdrawLeaveRequest,
} from './leave-request.api';

/** Chấm số đơn chờ duyệt — cùng nhịp 30 giây với các chấm số khác ở Sidebar. */
const PENDING_COUNT_REFETCH_MS = 30_000;

/** Danh sách đơn nghỉ. `userId` chỉ có tác dụng với scope global; scope personal backend tự ép về chính mình. */
export function useLeaveRequestsQuery(filter: { status?: LeaveRequestStatus; from?: string; to?: string; userId?: string }, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'leave-request', 'list', filter.status, filter.from, filter.to, filter.userId),
    queryFn: () => listLeaveRequests(filter),
    enabled,
  });
}

export function useLeaveRequestPendingCountQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'leave-request', 'pending-count'),
    queryFn: getLeaveRequestPendingCount,
    enabled,
    refetchInterval: PENDING_COUNT_REFETCH_MS,
  });
}

export function useLeaveRequestMyImpactQuery(leaveDate: string, workShiftId: string | null, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'leave-request', 'my-impact', leaveDate, workShiftId ?? 'ALL_DAY'),
    queryFn: () => getLeaveRequestMyImpact({ leaveDate, ...(workShiftId ? { workShiftId } : {}) }),
    enabled,
  });
}

export function useLeaveRequestAffectedAppointmentsQuery(id: string | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'leave-request', 'affected', id ?? 'none'),
    queryFn: () => getLeaveRequestAffectedAppointments(id as string),
    enabled: id !== null,
  });
}

/**
 * Mọi thao tác ghi đều làm mới danh sách/chấm số đơn nghỉ VÀ dữ liệu Lịch hẹn (khung nghỉ trên lưới,
 * cờ "Cần xử lý", ca đăng ký) — một đơn được duyệt/huỷ đổi ngay những gì lễ tân đang thấy.
 */
function useInvalidateLeave() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'leave-request') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'appointment') });
  };
}

export function useCreateLeaveRequestMutation() {
  const invalidate = useInvalidateLeave();
  return useMutation({ mutationFn: (body: CreateLeaveRequestRequest) => createLeaveRequest(body), onSuccess: invalidate });
}

export function useCreateLeaveRequestOnBehalfMutation() {
  const invalidate = useInvalidateLeave();
  return useMutation({ mutationFn: (body: CreateLeaveRequestOnBehalfRequest) => createLeaveRequestOnBehalf(body), onSuccess: invalidate });
}

export function useApproveLeaveRequestMutation() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & ApproveLeaveRequestRequest) => approveLeaveRequest(id, body),
    onSuccess: invalidate,
  });
}

export function useRejectLeaveRequestMutation() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & RejectLeaveRequestRequest) => rejectLeaveRequest(id, body),
    onSuccess: invalidate,
  });
}

export function useWithdrawLeaveRequestMutation() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & WithdrawLeaveRequestRequest) => withdrawLeaveRequest(id, body),
    onSuccess: invalidate,
  });
}

export function useCancelLeaveRequestMutation() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & CancelLeaveRequestRequest) => cancelLeaveRequest(id, body),
    onSuccess: invalidate,
  });
}
