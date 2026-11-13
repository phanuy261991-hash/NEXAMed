import type {
  CancelPurchaseOrderRequest,
  ClosePurchaseOrderRequest,
  CreatePurchaseOrderRequest,
  GetPurchaseOrderOptionsResponse,
  GetPurchaseOrderPendingCountsResponse,
  ListPurchaseOrdersQuery,
  ListPurchaseOrdersResponse,
  PurchaseOrderDetail,
  RejectPurchaseOrderRequest,
  ResolveStockRequestWithdrawRequest,
  StockRequestDetail,
  UpdatePurchaseOrderRequest,
  VersionedPurchaseOrderRequest,
} from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../shared/api/client';

// "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 giai đoạn 2). Kiểu trả về ép từ `@nexamed/shared` (hợp đồng OpenAPI sinh tự động chỉ là khuôn của đường dẫn).

const BASE = '/api/v1/inventory/purchase-orders';

export async function getPurchaseOrders(query: ListPurchaseOrdersQuery): Promise<ListPurchaseOrdersResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/purchase-orders', { params: { query } })) as ListPurchaseOrdersResponse;
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/purchase-orders/{id}', { params: { path: { id } } })) as PurchaseOrderDetail;
}

export async function getPurchaseOrderPendingCounts(): Promise<GetPurchaseOrderPendingCountsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/purchase-orders/pending-counts', {})) as GetPurchaseOrderPendingCountsResponse;
}

export async function getPurchaseOrderOptions(): Promise<GetPurchaseOrderOptionsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/purchase-orders/options', {})) as GetPurchaseOrderOptionsResponse;
}

export async function createPurchaseOrder(body: CreatePurchaseOrderRequest): Promise<PurchaseOrderDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/purchase-orders', { body })) as PurchaseOrderDetail;
}

export async function updatePurchaseOrder(id: string, body: UpdatePurchaseOrderRequest): Promise<PurchaseOrderDetail> {
  return unwrap(await getApiClient().PATCH('/api/v1/inventory/purchase-orders/{id}', { params: { path: { id } }, body })) as PurchaseOrderDetail;
}

export async function submitPurchaseOrder(id: string, body: VersionedPurchaseOrderRequest): Promise<PurchaseOrderDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/purchase-orders/{id}/submit', { params: { path: { id } }, body })) as PurchaseOrderDetail;
}

export async function approvePurchaseOrder(id: string, body: VersionedPurchaseOrderRequest): Promise<PurchaseOrderDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/purchase-orders/{id}/approve', { params: { path: { id } }, body })) as PurchaseOrderDetail;
}

export async function rejectPurchaseOrder(id: string, body: RejectPurchaseOrderRequest): Promise<PurchaseOrderDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/purchase-orders/{id}/reject', { params: { path: { id } }, body })) as PurchaseOrderDetail;
}

export async function orderPurchaseOrder(id: string, body: VersionedPurchaseOrderRequest): Promise<PurchaseOrderDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/purchase-orders/{id}/order', { params: { path: { id } }, body })) as PurchaseOrderDetail;
}

export async function closePurchaseOrder(id: string, body: ClosePurchaseOrderRequest): Promise<PurchaseOrderDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/purchase-orders/{id}/close', { params: { path: { id } }, body })) as PurchaseOrderDetail;
}

export async function cancelPurchaseOrder(id: string, body: CancelPurchaseOrderRequest): Promise<PurchaseOrderDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/purchase-orders/{id}/cancel', { params: { path: { id } }, body })) as PurchaseOrderDetail;
}

/** Kho cấp xác nhận / từ chối "Yêu cầu rút" của bên xin (dòng chờ hàng về gắn đơn đã đặt NCC). */
export async function resolveStockRequestWithdrawRequests(id: string, body: ResolveStockRequestWithdrawRequest): Promise<StockRequestDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/requests/{id}/withdraw-requests/resolve', { params: { path: { id } }, body })) as StockRequestDetail;
}

/** Tải Excel danh sách đơn đặt hàng. */
export async function exportPurchaseOrders(query: ListPurchaseOrdersQuery): Promise<void> {
  const params = new URLSearchParams({ view: query.view });
  if (query.status) params.set('status', query.status);
  if (query.supplierId) params.set('supplierId', query.supplierId);
  if (query.warehouseId) params.set('warehouseId', query.warehouseId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.q) params.set('q', query.q);
  await downloadFile(`${BASE}/export?${params.toString()}`, `don-dat-hang-ncc-${query.view === 'mine' ? 'cua-chi-nhanh' : 'can-duyet'}.xlsx`);
}
