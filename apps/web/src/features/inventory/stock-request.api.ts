import type {
  AddStockRequestLinesRequest,
  AllocateStockRequestRequest,
  CancelStockRequestRequest,
  CreateStockRequestRequest,
  EscalateStockRequestRequest,
  EscalateStockRequestResponse,
  GetStockRequestLowStockResponse,
  GetStockRequestOptionsResponse,
  GetStockRequestPendingCountsResponse,
  GetStockRequestRestockResponse,
  ListStockRequestsQuery,
  ListStockRequestsResponse,
  RejectStockRequestRequest,
  StockRequestDetail,
  UpdateStockRequestNoteRequest,
  UpdateStockRequestRequest,
  VersionedStockRequestRequest,
  WithdrawStockRequestLinesRequest,
} from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../shared/api/client';

// "Yêu cầu cấp hàng" (docs/DECISIONS.md #298). Kiểu trả về ép từ `@nexamed/shared` (hợp đồng OpenAPI sinh tự động chỉ là khuôn của đường dẫn).

const BASE = '/api/v1/inventory/requests';

export async function getStockRequests(query: ListStockRequestsQuery): Promise<ListStockRequestsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/requests', { params: { query } })) as ListStockRequestsResponse;
}

export async function getStockRequest(id: string): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/requests/{id}', { params: { path: { id } } })) as StockRequestDetail;
}

export async function getStockRequestPendingCounts(): Promise<GetStockRequestPendingCountsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/requests/pending-counts', {})) as GetStockRequestPendingCountsResponse;
}

export async function getStockRequestRestock(): Promise<GetStockRequestRestockResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/requests/restock', {})) as GetStockRequestRestockResponse;
}

export async function getStockRequestOptions(): Promise<GetStockRequestOptionsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/requests/options', {})) as GetStockRequestOptionsResponse;
}

export async function getStockRequestLowStock(warehouseId: string): Promise<GetStockRequestLowStockResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/requests/low-stock', { params: { query: { warehouseId } } })) as GetStockRequestLowStockResponse;
}

export async function createStockRequest(body: CreateStockRequestRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests', { body })) as StockRequestDetail;
}

export async function updateStockRequest(id: string, body: UpdateStockRequestRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().PATCH('/api/v1/inventory/requests/{id}', { params: { path: { id } }, body })) as StockRequestDetail;
}

export async function submitStockRequest(id: string, body: VersionedStockRequestRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/submit', { params: { path: { id } }, body })) as StockRequestDetail;
}

export async function cancelStockRequest(id: string, body: CancelStockRequestRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/cancel', { params: { path: { id } }, body })) as StockRequestDetail;
}

export async function noteStockRequest(id: string, body: UpdateStockRequestNoteRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/note', { params: { path: { id } }, body })) as StockRequestDetail;
}

export async function addStockRequestLines(id: string, body: AddStockRequestLinesRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/lines', { params: { path: { id } }, body })) as StockRequestDetail;
}

export async function withdrawStockRequestLines(id: string, body: WithdrawStockRequestLinesRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/withdraw-lines', { params: { path: { id } }, body })) as StockRequestDetail;
}

export async function acceptStockRequest(id: string, body: VersionedStockRequestRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/accept', { params: { path: { id } }, body })) as StockRequestDetail;
}

export async function rejectStockRequest(id: string, body: RejectStockRequestRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/reject', { params: { path: { id } }, body })) as StockRequestDetail;
}

export async function acknowledgeStockRequestUpdate(id: string): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/acknowledge-update', { params: { path: { id } } })) as StockRequestDetail;
}

export async function allocateStockRequest(id: string, body: AllocateStockRequestRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/allocate', { params: { path: { id } }, body })) as StockRequestDetail;
}

export async function escalateStockRequest(id: string, body: EscalateStockRequestRequest): Promise<EscalateStockRequestResponse> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/escalate', { params: { path: { id } }, body })) as EscalateStockRequestResponse;
}

/** Tải Excel danh sách — cố ý không đăng ký OpenAPI (binary), cùng khuôn `exportStockTransferShrinkage`. */
export async function exportStockRequests(query: ListStockRequestsQuery): Promise<void> {
  const params = new URLSearchParams({ view: query.view });
  if (query.status) params.set('status', query.status);
  if (query.priority) params.set('priority', query.priority);
  if (query.warehouseId) params.set('warehouseId', query.warehouseId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.q) params.set('q', query.q);
  await downloadFile(`${BASE}/export?${params.toString()}`, `yeu-cau-cap-hang-${query.view === 'mine' ? 'cua-toi' : 'can-duyet'}.xlsx`);
}
