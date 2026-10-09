import type {
  ApproveLeaveRequestRequest,
  CancelLeaveRequestRequest,
  CreateLeaveRequestOnBehalfRequest,
  CreateLeaveRequestRequest,
  LeaveRequestAffectedAppointmentsResponse,
  LeaveRequestItem,
  LeaveRequestMyImpactQuery,
  LeaveRequestMyImpactResponse,
  LeaveRequestPendingCountResponse,
  ListLeaveRequestsQuery,
  ListLeaveRequestsResponse,
  RejectLeaveRequestRequest,
  WithdrawLeaveRequestRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** "Đơn xin nghỉ" (#224) — đúng khuôn `work-shift-assignment.api.ts`. */
export async function listLeaveRequests(query: ListLeaveRequestsQuery): Promise<ListLeaveRequestsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/leave-requests', { params: { query } })) as ListLeaveRequestsResponse;
}

export async function getLeaveRequestPendingCount(): Promise<LeaveRequestPendingCountResponse> {
  return unwrap(await getApiClient().GET('/api/v1/leave-requests/pending-count', {})) as LeaveRequestPendingCountResponse;
}

export async function getLeaveRequestMyImpact(query: LeaveRequestMyImpactQuery): Promise<LeaveRequestMyImpactResponse> {
  return unwrap(await getApiClient().GET('/api/v1/leave-requests/my-impact', { params: { query } })) as LeaveRequestMyImpactResponse;
}

export async function getLeaveRequestAffectedAppointments(id: string): Promise<LeaveRequestAffectedAppointmentsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/leave-requests/{id}/affected-appointments', { params: { path: { id } } }),
  ) as LeaveRequestAffectedAppointmentsResponse;
}

export async function createLeaveRequest(body: CreateLeaveRequestRequest): Promise<LeaveRequestItem> {
  return unwrap(await getApiClient().POST('/api/v1/leave-requests', { body })) as LeaveRequestItem;
}

export async function createLeaveRequestOnBehalf(body: CreateLeaveRequestOnBehalfRequest): Promise<LeaveRequestItem> {
  return unwrap(await getApiClient().POST('/api/v1/leave-requests/on-behalf', { body })) as LeaveRequestItem;
}

export async function approveLeaveRequest(id: string, body: ApproveLeaveRequestRequest): Promise<LeaveRequestItem> {
  return unwrap(await getApiClient().POST('/api/v1/leave-requests/{id}/approve', { params: { path: { id } }, body })) as LeaveRequestItem;
}

export async function rejectLeaveRequest(id: string, body: RejectLeaveRequestRequest): Promise<LeaveRequestItem> {
  return unwrap(await getApiClient().POST('/api/v1/leave-requests/{id}/reject', { params: { path: { id } }, body })) as LeaveRequestItem;
}

export async function withdrawLeaveRequest(id: string, body: WithdrawLeaveRequestRequest): Promise<LeaveRequestItem> {
  return unwrap(await getApiClient().POST('/api/v1/leave-requests/{id}/withdraw', { params: { path: { id } }, body })) as LeaveRequestItem;
}

export async function cancelLeaveRequest(id: string, body: CancelLeaveRequestRequest): Promise<LeaveRequestItem> {
  return unwrap(await getApiClient().POST('/api/v1/leave-requests/{id}/cancel', { params: { path: { id } }, body })) as LeaveRequestItem;
}
