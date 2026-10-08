import type {
  AmendParaclinicalResultRequest,
  GetParaclinicalResultResponse,
  ListParaclinicalQueueQuery,
  ListParaclinicalQueueResponse,
  SaveParaclinicalResultRequest,
  StartParaclinicalItemsRequest,
  StartParaclinicalItemsResponse,
} from '@nexamed/shared';
import { getApiClient, unwrap, uploadFile } from '../../shared/api/client';
import type { ParaclinicalGroup } from './paraclinical-group';

/**
 * Cận lâm sàng GĐ4 — Hàng đợi & kết quả (docs/DECISIONS.md #212), tách 2 menu (#215): mỗi nhóm có đường dẫn API riêng (`/paraclinical/lab/...`, `/paraclinical/imaging/...`)
 * vì quyền khác nhau. Client sinh từ OpenAPI chỉ nhận đường dẫn hằng nên mỗi hàm rẽ nhánh theo nhóm.
 */

export async function listParaclinicalQueue(group: ParaclinicalGroup, query: ListParaclinicalQueueQuery): Promise<ListParaclinicalQueueResponse> {
  const client = getApiClient();
  const res = group === 'lab' ? await client.GET('/api/v1/paraclinical/lab/queue', { params: { query } }) : await client.GET('/api/v1/paraclinical/imaging/queue', { params: { query } });
  return unwrap(res) as ListParaclinicalQueueResponse;
}

/** "Gọi vào phòng" — CHỈ CĐHA & Thăm dò chức năng. Xét nghiệm không còn `start`: lấy mẫu đi qua ống mẫu (`specimen-tube.api.ts`, docs/DECISIONS.md #220). */
export async function startParaclinicalItems(body: StartParaclinicalItemsRequest): Promise<StartParaclinicalItemsResponse> {
  return unwrap(await getApiClient().POST('/api/v1/paraclinical/imaging/start', { body })) as StartParaclinicalItemsResponse;
}

export async function getParaclinicalResult(group: ParaclinicalGroup, itemId: string): Promise<GetParaclinicalResultResponse> {
  const client = getApiClient();
  const params = { params: { path: { itemId } } };
  const res = group === 'lab' ? await client.GET('/api/v1/paraclinical/lab/items/{itemId}/result', params) : await client.GET('/api/v1/paraclinical/imaging/items/{itemId}/result', params);
  return unwrap(res) as GetParaclinicalResultResponse;
}

export async function saveParaclinicalResult(group: ParaclinicalGroup, itemId: string, body: SaveParaclinicalResultRequest): Promise<GetParaclinicalResultResponse> {
  const client = getApiClient();
  const args = { params: { path: { itemId } }, body };
  const res = group === 'lab' ? await client.PUT('/api/v1/paraclinical/lab/items/{itemId}/result', args) : await client.PUT('/api/v1/paraclinical/imaging/items/{itemId}/result', args);
  return unwrap(res) as GetParaclinicalResultResponse;
}

export async function approveParaclinicalResult(group: ParaclinicalGroup, itemId: string, body: SaveParaclinicalResultRequest): Promise<GetParaclinicalResultResponse> {
  const client = getApiClient();
  const args = { params: { path: { itemId } }, body };
  const res =
    group === 'lab' ? await client.POST('/api/v1/paraclinical/lab/items/{itemId}/result/approve', args) : await client.POST('/api/v1/paraclinical/imaging/items/{itemId}/result/approve', args);
  return unwrap(res) as GetParaclinicalResultResponse;
}

/** "Đính chính" kết quả đã duyệt (quyền Nhập của nhóm): bản đã ký được giữ lại, dịch vụ quay lại "Đang thực hiện". */
export async function amendParaclinicalResult(group: ParaclinicalGroup, itemId: string, body: AmendParaclinicalResultRequest): Promise<GetParaclinicalResultResponse> {
  const client = getApiClient();
  const args = { params: { path: { itemId } }, body };
  const res =
    group === 'lab' ? await client.POST('/api/v1/paraclinical/lab/items/{itemId}/result/amend', args) : await client.POST('/api/v1/paraclinical/imaging/items/{itemId}/result/amend', args);
  return unwrap(res) as GetParaclinicalResultResponse;
}

/** Huỷ đính chính đang soạn/chờ duyệt — khôi phục bản đã duyệt cũ. */
export async function cancelParaclinicalAmendment(group: ParaclinicalGroup, itemId: string): Promise<GetParaclinicalResultResponse> {
  const client = getApiClient();
  const params = { params: { path: { itemId } } };
  const res =
    group === 'lab' ? await client.POST('/api/v1/paraclinical/lab/items/{itemId}/result/amend/cancel', params) : await client.POST('/api/v1/paraclinical/imaging/items/{itemId}/result/amend/cancel', params);
  return unwrap(res) as GetParaclinicalResultResponse;
}

/** Ghi audit mỗi lần in phiếu kết quả (dữ liệu y tế đưa ra giấy). */
export async function recordParaclinicalResultPrint(group: ParaclinicalGroup, itemId: string): Promise<void> {
  const client = getApiClient();
  const params = { params: { path: { itemId } } };
  unwrap(group === 'lab' ? await client.POST('/api/v1/paraclinical/lab/items/{itemId}/result/print', params) : await client.POST('/api/v1/paraclinical/imaging/items/{itemId}/result/print', params));
}

/** Ảnh đính kèm kết quả CĐHA (multipart nên gọi `uploadFile`, không qua client sinh từ OpenAPI). Chỉ nhóm CĐHA & Thăm dò chức năng có ảnh. */
export async function uploadParaclinicalImage(itemId: string, file: File): Promise<GetParaclinicalResultResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadFile<GetParaclinicalResultResponse>(`/api/v1/paraclinical/imaging/items/${itemId}/images`, formData);
}

export async function deleteParaclinicalImage(imageId: string): Promise<GetParaclinicalResultResponse> {
  return unwrap(await getApiClient().DELETE('/api/v1/paraclinical/imaging/images/{imageId}', { params: { path: { imageId } } })) as GetParaclinicalResultResponse;
}
