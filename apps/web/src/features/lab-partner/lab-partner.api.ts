import type {
  ApproveLabPartnerResultRequest,
  LabPartnerQueueCounts,
  ListLabPartnerAwaitingResponse,
  ListLabPartnerDoneResponse,
  ReceiveLabPartnerResultRequest,
  ReceiveLabPartnerResultResponse,
  RejectLabPartnerItemRequest,
  ReturnLabPartnerResultRequest,
  ListLabPartnerPendingResponse,
  ListLabPartnerQueueQuery,
  ListLabPartnerSentResponse,
  SendLabPartnerSamplesRequest,
  SendLabPartnerSamplesResponse,
} from '@nexamed/shared';
import { getApiClient, unwrap, uploadFile } from '../../shared/api/client';

/** Gửi mẫu xét nghiệm cho đối tác (docs/DECISIONS.md #291): hàng đợi "Chờ gửi" / "Đã gửi, chờ kết quả" và thao tác gửi một đợt cho MỘT đối tác. */

export async function listLabPartnerPending(query: ListLabPartnerQueueQuery): Promise<ListLabPartnerPendingResponse> {
  return unwrap(await getApiClient().GET('/api/v1/lab-partner-dispatch/pending', { params: { query } })) as ListLabPartnerPendingResponse;
}

export async function listLabPartnerSent(query: ListLabPartnerQueueQuery): Promise<ListLabPartnerSentResponse> {
  return unwrap(await getApiClient().GET('/api/v1/lab-partner-dispatch/sent', { params: { query } })) as ListLabPartnerSentResponse;
}

export async function sendLabPartnerSamples(body: SendLabPartnerSamplesRequest): Promise<SendLabPartnerSamplesResponse> {
  return unwrap(await getApiClient().POST('/api/v1/lab-partner-dispatch', { body })) as SendLabPartnerSamplesResponse;
}

export async function getLabPartnerCounts(): Promise<{ counts: LabPartnerQueueCounts }> {
  return unwrap(await getApiClient().GET('/api/v1/lab-partner-dispatch/counts')) as { counts: LabPartnerQueueCounts };
}

export async function listLabPartnerAwaiting(query: { encounterId?: string; mine?: boolean }): Promise<ListLabPartnerAwaitingResponse> {
  const params = { ...(query.encounterId ? { encounterId: query.encounterId } : {}), ...(query.mine ? { mine: 'true' as const } : {}) };
  return unwrap(await getApiClient().GET('/api/v1/lab-partner-dispatch/awaiting', { params: { query: params } })) as ListLabPartnerAwaitingResponse;
}

export async function listLabPartnerDone(query: ListLabPartnerQueueQuery): Promise<ListLabPartnerDoneResponse> {
  return unwrap(await getApiClient().GET('/api/v1/lab-partner-dispatch/done', { params: { query } })) as ListLabPartnerDoneResponse;
}

/** Nhận kết quả: multipart (trường `file` = PDF, trường `data` = JSON) nên gọi `uploadFile`, không qua client sinh từ OpenAPI. */
export async function receiveLabPartnerResult(file: File, data: ReceiveLabPartnerResultRequest): Promise<ReceiveLabPartnerResultResponse> {
  const formData = new FormData();
  formData.append('data', JSON.stringify(data));
  formData.append('file', file);
  return uploadFile<ReceiveLabPartnerResultResponse>('/api/v1/lab-partner-dispatch/results', formData);
}

export async function rejectLabPartnerItem(itemId: string, body: RejectLabPartnerItemRequest): Promise<void> {
  unwrap(await getApiClient().POST('/api/v1/lab-partner-dispatch/items/{itemId}/reject', { params: { path: { itemId } }, body }));
}

export async function approveLabPartnerResult(itemId: string, body: ApproveLabPartnerResultRequest): Promise<void> {
  unwrap(await getApiClient().POST('/api/v1/lab-partner-dispatch/items/{itemId}/approve', { params: { path: { itemId } }, body }));
}

export async function returnLabPartnerResult(itemId: string, body: ReturnLabPartnerResultRequest): Promise<void> {
  unwrap(await getApiClient().POST('/api/v1/lab-partner-dispatch/items/{itemId}/return', { params: { path: { itemId } }, body }));
}
