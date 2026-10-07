import type {
  GetParaclinicalResultResponse,
  ListParaclinicalQueueQuery,
  ListParaclinicalQueueResponse,
  SaveParaclinicalResultRequest,
  StartParaclinicalItemsRequest,
  StartParaclinicalItemsResponse,
} from '@nexamed/shared';
import { getApiClient, unwrap, uploadFile } from '../../shared/api/client';

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

/** Ghi audit mỗi lần in phiếu kết quả (dữ liệu y tế đưa ra giấy). */
export async function recordParaclinicalResultPrint(itemId: string): Promise<void> {
  unwrap(await getApiClient().POST('/api/v1/paraclinical/items/{itemId}/result/print', { params: { path: { itemId } } }));
}

/** Ảnh đính kèm kết quả CĐHA (multipart nên gọi `uploadFile`, không qua client sinh từ OpenAPI). */
export async function uploadParaclinicalImage(itemId: string, file: File): Promise<GetParaclinicalResultResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadFile<GetParaclinicalResultResponse>(`/api/v1/paraclinical/items/${itemId}/images`, formData);
}

export async function deleteParaclinicalImage(imageId: string): Promise<GetParaclinicalResultResponse> {
  return unwrap(await getApiClient().DELETE('/api/v1/paraclinical/images/{imageId}', { params: { path: { imageId } } })) as GetParaclinicalResultResponse;
}
