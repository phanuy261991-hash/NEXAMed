import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BulkCreateWorkShiftAssignmentRequest, CopyWorkShiftAssignmentsRequest, CreateWorkShiftAssignmentRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  bulkCreateWorkShiftAssignments,
  copyWorkShiftAssignments,
  createWorkShiftAssignment,
  deleteWorkShiftAssignment,
  getWorkShiftAssignmentMonthLockStatus,
  listWorkShiftAssignments,
} from './work-shift-assignment.api';

/** "Đăng ký ca làm việc" (Giai đoạn 2 của #101) — `userId` chỉ có ý nghĩa cho scope global ("Lịch
 * làm việc nhân viên"); scope personal ("Lịch làm việc của tôi") luôn để trống, backend tự ép về
 * chính actor. Cache key thêm `userId` để 2 trang không lẫn cache của nhau. */
export function useWorkShiftAssignmentsQuery(from: string, to: string, userId?: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'work-shift-assignment', 'list', from, to, userId),
    queryFn: () => listWorkShiftAssignments({ from, to, userId }),
  });
}

/** "Khoá bảng ca" theo tháng (2026-09-03) — tự-phục vụ, đúng khuôn `useAllowStaffSelfScheduleEnabledQuery`.
 * Gọi cho từng tháng riêng (React Query dedupe cache key trùng nhau tự động khi 2 lời gọi cùng `month`). */
export function useWorkShiftAssignmentMonthLockStatusQuery(month: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'work-shift-assignment', 'month-lock-status', month),
    queryFn: () => getWorkShiftAssignmentMonthLockStatus(month),
  });
}

function invalidateList(queryClient: ReturnType<typeof useQueryClient>, tenantId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'work-shift-assignment', 'list') });
}

export function useCreateWorkShiftAssignmentMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkShiftAssignmentRequest) => createWorkShiftAssignment(body),
    onSuccess: () => invalidateList(queryClient, tenantId),
  });
}

export function useBulkCreateWorkShiftAssignmentsMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkCreateWorkShiftAssignmentRequest) => bulkCreateWorkShiftAssignments(body),
    onSuccess: () => invalidateList(queryClient, tenantId),
  });
}

export function useCopyWorkShiftAssignmentsMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CopyWorkShiftAssignmentsRequest) => copyWorkShiftAssignments(body),
    onSuccess: () => invalidateList(queryClient, tenantId),
  });
}

export function useDeleteWorkShiftAssignmentMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => deleteWorkShiftAssignment(id, version),
    onSuccess: () => invalidateList(queryClient, tenantId),
  });
}
