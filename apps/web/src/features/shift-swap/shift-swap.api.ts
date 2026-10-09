import type {
  AcceptShiftSwapRequest,
  CancelShiftSwapRequest,
  CreateShiftSwapRequest,
  DeclineShiftSwapRequest,
  ListShiftSwapCandidatesResponse,
  ListShiftSwapColleaguesResponse,
  ListShiftSwapsQuery,
  ListShiftSwapsResponse,
  ShiftSwapCheckResponse,
  ShiftSwapCountResponse,
  ShiftSwapItem,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** "Đổi ca" (#225) — đúng khuôn `leave-request.api.ts`. */
export async function listShiftSwaps(query: ListShiftSwapsQuery): Promise<ListShiftSwapsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/shift-swaps', { params: { query } })) as ListShiftSwapsResponse;
}

export async function getShiftSwapIncomingCount(): Promise<ShiftSwapCountResponse> {
  return unwrap(await getApiClient().GET('/api/v1/shift-swaps/incoming-count', {})) as ShiftSwapCountResponse;
}

export async function getShiftSwapUnseenCount(): Promise<ShiftSwapCountResponse> {
  return unwrap(await getApiClient().GET('/api/v1/shift-swaps/unseen-count', {})) as ShiftSwapCountResponse;
}

export async function markShiftSwapsSeen(): Promise<ShiftSwapCountResponse> {
  return unwrap(await getApiClient().POST('/api/v1/shift-swaps/mark-seen', {})) as ShiftSwapCountResponse;
}

export async function listShiftSwapColleagues(): Promise<ListShiftSwapColleaguesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/shift-swaps/colleagues', {})) as ListShiftSwapColleaguesResponse;
}

export async function listShiftSwapColleagueAssignments(userId: string): Promise<ListShiftSwapCandidatesResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/shift-swaps/colleagues/{userId}/assignments', { params: { path: { userId } } }),
  ) as ListShiftSwapCandidatesResponse;
}

export async function checkShiftSwapAssignment(assignmentId: string): Promise<ShiftSwapCheckResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/shift-swaps/assignments/{assignmentId}/check', { params: { path: { assignmentId } } }),
  ) as ShiftSwapCheckResponse;
}

export async function createShiftSwap(body: CreateShiftSwapRequest): Promise<ShiftSwapItem> {
  return unwrap(await getApiClient().POST('/api/v1/shift-swaps', { body })) as ShiftSwapItem;
}

export async function acceptShiftSwap(id: string, body: AcceptShiftSwapRequest): Promise<ShiftSwapItem> {
  return unwrap(await getApiClient().POST('/api/v1/shift-swaps/{id}/accept', { params: { path: { id } }, body })) as ShiftSwapItem;
}

export async function declineShiftSwap(id: string, body: DeclineShiftSwapRequest): Promise<ShiftSwapItem> {
  return unwrap(await getApiClient().POST('/api/v1/shift-swaps/{id}/decline', { params: { path: { id } }, body })) as ShiftSwapItem;
}

export async function cancelShiftSwap(id: string, body: CancelShiftSwapRequest): Promise<ShiftSwapItem> {
  return unwrap(await getApiClient().POST('/api/v1/shift-swaps/{id}/cancel', { params: { path: { id } }, body })) as ShiftSwapItem;
}
