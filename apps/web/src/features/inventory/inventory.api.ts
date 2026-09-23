import type {
  ApproveStockCountRequest,
  ApproveStockReceiptRequest,
  CreateStockCountRequest,
  CreateStockIssueRequest,
  CreateStockReceiptRequest,
  CreateStockTransferRequest,
  GetDrugBatchBalancesResponse,
  GetDrugLedgerResponse,
  GetPrescriptionDispenseStatusResponse,
  ListDispenseQueueQuery,
  ListDispenseQueueResponse,
  ListStockBalancesQuery,
  ListStockBalancesResponse,
  ListStockCountsQuery,
  ListStockCountsResponse,
  ListStockExpiryWarningsResponse,
  ListStockIssuesQuery,
  ListStockIssuesResponse,
  ListStockReceiptsQuery,
  ListStockReceiptsResponse,
  ListStockTransfersQuery,
  ListStockTransfersResponse,
  ReceiveStockTransferRequest,
  RejectStockCountRequest,
  RejectStockReceiptRequest,
  RejectStockTransferRequest,
  ShipStockTransferRequest,
  StockCountDetail,
  StockIssueDetail,
  StockReceiptDetail,
  StockTransferDetail,
  UpdateStockCountRequest,
  UpdateStockReceiptRequest,
  UpdateStockTransferRequest,
  VoidStockIssueRequest,
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

// ============ Kho Thuốc GĐ3 — "Phiếu xuất kho" / "Phát thuốc" (docs/DECISIONS.md #163) ============

export async function getStockIssues(query: ListStockIssuesQuery): Promise<ListStockIssuesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/issues', { params: { query } })) as ListStockIssuesResponse;
}

export async function getStockIssue(id: string): Promise<StockIssueDetail> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/issues/{id}', { params: { path: { id } } })) as StockIssueDetail;
}

export async function createStockIssue(body: CreateStockIssueRequest): Promise<StockIssueDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/issues', { body })) as StockIssueDetail;
}

export async function voidStockIssue(id: string, body: VoidStockIssueRequest): Promise<StockIssueDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/issues/{id}/void', { params: { path: { id } }, body })) as StockIssueDetail;
}

export async function getPrescriptionDispenseStatus(prescriptionId: string, warehouseId?: string): Promise<GetPrescriptionDispenseStatusResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/inventory/prescriptions/{prescriptionId}/dispense-status', { params: { path: { prescriptionId }, query: { warehouseId } } }),
  ) as GetPrescriptionDispenseStatusResponse;
}

export async function getDispenseQueue(query: ListDispenseQueueQuery): Promise<ListDispenseQueueResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/dispense-queue', { params: { query } })) as ListDispenseQueueResponse;
}

// ============ Kho Thuốc GĐ4 — "Kiểm kê" (docs/DECISIONS.md #170) ============

export async function getStockCounts(query: ListStockCountsQuery): Promise<ListStockCountsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/counts', { params: { query } })) as ListStockCountsResponse;
}

export async function getStockCount(id: string): Promise<StockCountDetail> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/counts/{id}', { params: { path: { id } } })) as StockCountDetail;
}

export async function createStockCount(body: CreateStockCountRequest): Promise<StockCountDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/counts', { body })) as StockCountDetail;
}

export async function updateStockCount(id: string, body: UpdateStockCountRequest): Promise<StockCountDetail> {
  return unwrap(await getApiClient().PATCH('/api/v1/inventory/counts/{id}', { params: { path: { id } }, body })) as StockCountDetail;
}

export async function approveStockCount(id: string, body: ApproveStockCountRequest): Promise<StockCountDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/counts/{id}/approve', { params: { path: { id } }, body })) as StockCountDetail;
}

export async function rejectStockCount(id: string, body: RejectStockCountRequest): Promise<StockCountDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/counts/{id}/reject', { params: { path: { id } }, body })) as StockCountDetail;
}

// ============ Kho Thuốc GĐ4 — "Điều chuyển kho" (docs/DECISIONS.md #170) ============

export async function getStockTransfers(query: ListStockTransfersQuery): Promise<ListStockTransfersResponse> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/transfers', { params: { query } })) as ListStockTransfersResponse;
}

export async function getStockTransfer(id: string): Promise<StockTransferDetail> {
  return unwrap(await getApiClient().GET('/api/v1/inventory/transfers/{id}', { params: { path: { id } } })) as StockTransferDetail;
}

export async function createStockTransfer(body: CreateStockTransferRequest): Promise<StockTransferDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/transfers', { body })) as StockTransferDetail;
}

export async function updateStockTransfer(id: string, body: UpdateStockTransferRequest): Promise<StockTransferDetail> {
  return unwrap(await getApiClient().PATCH('/api/v1/inventory/transfers/{id}', { params: { path: { id } }, body })) as StockTransferDetail;
}

export async function shipStockTransfer(id: string, body: ShipStockTransferRequest): Promise<StockTransferDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/transfers/{id}/ship', { params: { path: { id } }, body })) as StockTransferDetail;
}

export async function rejectStockTransfer(id: string, body: RejectStockTransferRequest): Promise<StockTransferDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/transfers/{id}/reject', { params: { path: { id } }, body })) as StockTransferDetail;
}

export async function receiveStockTransfer(id: string, body: ReceiveStockTransferRequest): Promise<StockTransferDetail> {
  return unwrap(await getApiClient().POST('/api/v1/inventory/transfers/{id}/receive', { params: { path: { id } }, body })) as StockTransferDetail;
}
