import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateFollowUpReminderRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createFollowUpReminder, exportFollowUps, listFollowUpReminders, listFollowUps, type FollowUpFilterParams } from './follow-up.api';

const PAGE_SIZE = 50;

/** Danh sách Hẹn tái khám theo tab/tìm kiếm/bác sĩ — cuộn vô hạn theo con trỏ; giữ dữ liệu cũ trong lúc đổi bộ lọc để số tab không nhấp nháy. */
export function useFollowUpsQuery(params: FollowUpFilterParams) {
  const { tenantId } = useAppConfig();
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, 'follow-up', 'list', params.tab, params.q.trim(), params.doctorId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => listFollowUps({ ...params, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useFollowUpRemindersQuery(encounterId: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'follow-up', 'reminders', encounterId),
    queryFn: () => listFollowUpReminders(encounterId),
    enabled: enabled && encounterId !== '',
  });
}

/** Ghi lần nhắc: làm mới danh sách (số lần nhắc, lần gần nhất, hẹn biến mất khi "không tái khám") và lịch sử của hẹn đó. */
export function useCreateFollowUpReminderMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFollowUpReminderRequest) => createFollowUpReminder(encounterId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'follow-up') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'report', 'dashboard', 'reception') });
    },
  });
}

export function useExportFollowUpsMutation() {
  return useMutation({ mutationFn: (params: FollowUpFilterParams) => exportFollowUps(params) });
}
