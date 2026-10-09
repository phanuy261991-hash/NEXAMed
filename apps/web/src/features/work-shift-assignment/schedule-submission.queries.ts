import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApproveScheduleSubmissionRequest, ReturnScheduleSubmissionRequest, SubmitScheduleSubmissionRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  approveScheduleSubmission,
  getScheduleSubmissionPendingCount,
  listScheduleSubmissions,
  returnScheduleSubmission,
  submitScheduleSubmission,
} from './schedule-submission.api';

/** Chấm số chờ duyệt — cùng nhịp 30 giây với các chấm số khác ở Sidebar. */
const PENDING_COUNT_REFETCH_MS = 30_000;

/** Bảng tháng. `userId` chỉ có tác dụng với scope global; scope personal backend tự ép về chính mình. */
export function useScheduleSubmissionsQuery(filter: { month?: string; status?: 'SUBMITTED' | 'APPROVED' | 'RETURNED'; userId?: string }, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'work-schedule-submission', 'list', filter.month, filter.status, filter.userId),
    queryFn: () => listScheduleSubmissions(filter),
    enabled,
  });
}

export function useScheduleSubmissionPendingCountQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'work-schedule-submission', 'pending-count'),
    queryFn: getScheduleSubmissionPendingCount,
    enabled,
    refetchInterval: PENDING_COUNT_REFETCH_MS,
  });
}

/** Mọi thao tác làm mới bảng tháng + danh sách ca (`canEdit` đổi theo trạng thái). */
function useInvalidateSubmission() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'work-schedule-submission') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'work-shift-assignment') });
  };
}

export function useSubmitScheduleSubmissionMutation() {
  const invalidate = useInvalidateSubmission();
  return useMutation({ mutationFn: (body: SubmitScheduleSubmissionRequest) => submitScheduleSubmission(body), onSuccess: invalidate });
}

export function useApproveScheduleSubmissionMutation() {
  const invalidate = useInvalidateSubmission();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & ApproveScheduleSubmissionRequest) => approveScheduleSubmission(id, body),
    onSuccess: invalidate,
  });
}

export function useReturnScheduleSubmissionMutation() {
  const invalidate = useInvalidateSubmission();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & ReturnScheduleSubmissionRequest) => returnScheduleSubmission(id, body),
    onSuccess: invalidate,
  });
}
