import type { CreateFollowUpReminderRequest, FollowUpTabKind, ListFollowUpRemindersResponse, ListFollowUpsResponse } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../shared/api/client';

export interface FollowUpFilterParams {
  tab: FollowUpTabKind;
  q: string;
  doctorId: string;
}

export async function listFollowUps(params: FollowUpFilterParams & { cursor?: string; limit?: number }): Promise<ListFollowUpsResponse> {
  const query = {
    tab: params.tab,
    ...(params.q.trim() !== '' ? { q: params.q.trim() } : {}),
    ...(params.doctorId !== '' ? { doctorId: params.doctorId } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
    ...(params.limit ? { limit: params.limit } : {}),
  };
  return unwrap(await getApiClient().GET('/api/v1/follow-ups', { params: { query } })) as ListFollowUpsResponse;
}

export async function listFollowUpReminders(encounterId: string): Promise<ListFollowUpRemindersResponse> {
  return unwrap(await getApiClient().GET('/api/v1/follow-ups/{encounterId}/reminders', { params: { path: { encounterId } } })) as ListFollowUpRemindersResponse;
}

export async function createFollowUpReminder(encounterId: string, body: CreateFollowUpReminderRequest): Promise<{ id: string; remindedAt: string }> {
  return unwrap(await getApiClient().POST('/api/v1/follow-ups/{encounterId}/reminders', { params: { path: { encounterId } }, body })) as { id: string; remindedAt: string };
}

/** Xuất Excel — tải file thô qua `downloadFile()` (endpoint trả `.xlsx` nhị phân, không có envelope), đúng bộ lọc đang xem. */
export async function exportFollowUps(params: FollowUpFilterParams): Promise<void> {
  const search = new URLSearchParams({ tab: params.tab });
  if (params.q.trim() !== '') search.set('q', params.q.trim());
  if (params.doctorId !== '') search.set('doctorId', params.doctorId);
  await downloadFile(`/api/v1/follow-ups/export?${search.toString()}`, `hen-tai-kham-${params.tab}.xlsx`);
}
