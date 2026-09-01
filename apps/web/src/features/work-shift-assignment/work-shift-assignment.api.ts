import type {
  BulkCreateWorkShiftAssignmentRequest,
  CopyWorkShiftAssignmentsRequest,
  CreateWorkShiftAssignmentRequest,
  ListWorkShiftAssignmentsQuery,
  ListWorkShiftAssignmentsResponse,
  WorkShiftAssignmentBulkResult,
  WorkShiftAssignmentItem,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** "Đăng ký ca làm việc" (Giai đoạn 2 của #101) — CRUD tối thiểu, đúng khuôn `clinic.api.ts`. */
export async function listWorkShiftAssignments(query: ListWorkShiftAssignmentsQuery): Promise<ListWorkShiftAssignmentsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/work-shift-assignments', { params: { query } })) as ListWorkShiftAssignmentsResponse;
}

export async function createWorkShiftAssignment(body: CreateWorkShiftAssignmentRequest): Promise<WorkShiftAssignmentItem> {
  return unwrap(await getApiClient().POST('/api/v1/work-shift-assignments', { body })) as WorkShiftAssignmentItem;
}

export async function bulkCreateWorkShiftAssignments(body: BulkCreateWorkShiftAssignmentRequest): Promise<WorkShiftAssignmentBulkResult> {
  return unwrap(await getApiClient().POST('/api/v1/work-shift-assignments/bulk', { body })) as WorkShiftAssignmentBulkResult;
}

export async function copyWorkShiftAssignments(body: CopyWorkShiftAssignmentsRequest): Promise<WorkShiftAssignmentBulkResult> {
  return unwrap(await getApiClient().POST('/api/v1/work-shift-assignments/copy', { body })) as WorkShiftAssignmentBulkResult;
}

export async function deleteWorkShiftAssignment(id: string, version: number): Promise<void> {
  await getApiClient().DELETE('/api/v1/work-shift-assignments/{id}', { params: { path: { id } }, body: { version } });
}
