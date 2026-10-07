import type {
  GetParaclinicalResultResponse,
  ListParaclinicalQueueQuery,
  ListParaclinicalQueueResponse,
  SaveParaclinicalResultRequest,
  StartParaclinicalItemsRequest,
  StartParaclinicalItemsResponse,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** Cận lâm sàng GĐ4 đợt 1 — Hàng đợi & kết quả (docs/DECISIONS.md #212). */

export async function listParaclinicalQueue(query: ListParaclinicalQueueQuery): Promise<ListParaclinicalQueueResponse> {
  return unwrap(await getApiClient().GET('/api/v1/paraclinical/queue', { params: { query } })) as ListParaclinicalQueueResponse;
}

export async function startParaclinicalItems(body: StartParaclinicalItemsRequest): Promise<StartParaclinicalItemsResponse> {
  return unwrap(await getApiClient().POST('/api/v1/paraclinical/start', { body })) as StartParaclinicalItemsResponse;
}

export async function getParaclinicalResult(itemId: string): Promise<GetParaclinicalResultResponse> {
  return unwrap(await getApiClient().GET('/api/v1/paraclinical/items/{itemId}/result', { params: { path: { itemId } } })) as GetParaclinicalResultResponse;
}

export async function saveParaclinicalResult(itemId: string, body: SaveParaclinicalResultRequest): Promise<GetParaclinicalResultResponse> {
  return unwrap(await getApiClient().PUT('/api/v1/paraclinical/items/{itemId}/result', { params: { path: { itemId } }, body })) as GetParaclinicalResultResponse;
}

export async function approveParaclinicalResult(itemId: string, body: SaveParaclinicalResultRequest): Promise<GetParaclinicalResultResponse> {
  return unwrap(await getApiClient().POST('/api/v1/paraclinical/items/{itemId}/result/approve', { params: { path: { itemId } }, body })) as GetParaclinicalResultResponse;
}
