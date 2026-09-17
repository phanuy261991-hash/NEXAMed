import type {
  ApproveStockReceiptRequest,
  CreateStockReceiptRequest,
  GetDrugBatchBalancesResponse,
  GetDrugLedgerResponse,
  ListStockBalancesQuery,
  ListStockBalancesResponse,
  ListStockExpiryWarningsResponse,
  ListStockReceiptsQuery,
  ListStockReceiptsResponse,
  RejectStockReceiptRequest,
  StockReceiptDetail,
  UpdateStockReceiptRequest,
  VoidStockReceiptRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function getStockReceipts(query: ListStockReceiptsQuery): Promise<ListStockReceiptsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/receipts', { params: { query } })) as ListStockReceiptsResponse;
}

export async function getStockReceipt(id: string): Promise<StockReceiptDetail> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/receipts/{id}', { params: { path: { id } } })) as StockReceiptDetail;
}

export async function createStockReceipt(body: CreateStockReceiptRequest): Promise<StockReceiptDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/receipts', { body })) as StockReceiptDetail;
}

export async function updateStockReceipt(id: string, body: UpdateStockReceiptRequest): Promise<StockReceiptDetail> {
  return unwrap(await getApiClient().PATCH('/api/v1/inventory/receipts/{id}', { params: { path: { id } }, body })) as StockReceiptDetail;
}

export async function approveStockReceipt(id: string, body: ApproveStockReceiptRequest): Promise<StockReceiptDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/receipts/{id}/approve', { params: { path: { id } }, body })) as StockReceiptDetail;
}

export async function rejectStockReceipt(id: string, body: RejectStockReceiptRequest): Promise<StockReceiptDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/receipts/{id}/reject', { params: { path: { id } }, body })) as StockReceiptDetail;
}

export async function voidStockReceipt(id: string, body: VoidStockReceiptRequest): Promise<StockReceiptDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/receipts/{id}/void', { params: { path: { id } }, body })) as StockReceiptDetail;
}

export async function getStockBalances(query: ListStockBalancesQuery): Promise<ListStockBalancesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/balances', { params: { query } })) as ListStockBalancesResponse;
}

export async function getDrugBatchBalances(drugId: string, warehouseId?: string): Promise<GetDrugBatchBalancesResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/inventory/drugs/{drugId}/balances', { params: { path: { drugId }, query: { warehouseId } } }),
  ) as GetDrugBatchBalancesResponse;
}

export async function getDrugLedger(drugId: string, params: { warehouseId?: string; limit?: number } = {}): Promise<GetDrugLedgerResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/drugs/{drugId}/ledger', { params: { path: { drugId }, query: params } })) as GetDrugLedgerResponse;
}

export async function getStockExpiryWarnings(warehouseId?: string): Promise<ListStockExpiryWarningsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/expiry-warnings', { params: { query: { warehouseId } } })) as ListStockExpiryWarningsResponse;
}
