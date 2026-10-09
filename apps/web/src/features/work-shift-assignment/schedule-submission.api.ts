import type {
  ApproveScheduleSubmissionRequest,
  ListScheduleSubmissionsQuery,
  ListScheduleSubmissionsResponse,
  ReturnScheduleSubmissionRequest,
  ScheduleSubmissionItem,
  ScheduleSubmissionPendingCountResponse,
  SubmitScheduleSubmissionRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** "Duyệt đăng ký ca theo tháng" (#225) — đúng khuôn `leave-request.api.ts`. */
export async function listScheduleSubmissions(query: ListScheduleSubmissionsQuery): Promise<ListScheduleSubmissionsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/work-shift-assignments/submissions', { params: { query } })) as ListScheduleSubmissionsResponse;
}

export async function getScheduleSubmissionPendingCount(): Promise<ScheduleSubmissionPendingCountResponse> {
  return unwrap(await getApiClient().GET('/api/v1/work-shift-assignments/submissions/pending-count', {})) as ScheduleSubmissionPendingCountResponse;
}

export async function submitScheduleSubmission(body: SubmitScheduleSubmissionRequest): Promise<ScheduleSubmissionItem> {
  return unwrap(await getApiClient().POST('/api/v1/work-shift-assignments/submissions/submit', { body })) as ScheduleSubmissionItem;
}

export async function approveScheduleSubmission(id: string, body: ApproveScheduleSubmissionRequest): Promise<ScheduleSubmissionItem> {
  return unwrap(
    await getApiClient().POST('/api/v1/work-shift-assignments/submissions/{id}/approve', { params: { path: { id } }, body }),
  ) as ScheduleSubmissionItem;
}

export async function returnScheduleSubmission(id: string, body: ReturnScheduleSubmissionRequest): Promise<ScheduleSubmissionItem> {
  return unwrap(
    await getApiClient().POST('/api/v1/work-shift-assignments/submissions/{id}/return', { params: { path: { id } }, body }),
  ) as ScheduleSubmissionItem;
}
