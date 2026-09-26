import type {
  ApproveSupplierDebtAdjustmentRequest,
  CreateSupplierDebtAdjustmentRequest,
  CreateSupplierDebtReconciliationRequest,
  FinalizeSupplierDebtReconciliationRequest,
  ListSupplierDebtAdjustmentsQuery,
  ListSupplierDebtAdjustmentsResponse,
  ListSupplierDebtLedgerQuery,
  ListSupplierDebtLedgerResponse,
  ListSupplierDebtPaymentsQuery,
  ListSupplierDebtPaymentsResponse,
  ListSupplierDebtReceiptsResponse,
  ListSupplierDebtReconciliationsResponse,
  ListSupplierDebtSummariesResponse,
  PreviewSupplierDebtReconciliationResponse,
  RecordSupplierDebtOpeningBalanceRequest,
  RecordSupplierDebtPaymentRequest,
  RecordSupplierDebtRefundRequest,
  RejectSupplierDebtAdjustmentRequest,
  SupplierDebtAdjustment,
  SupplierDebtReconciliation,
  SupplierDebtSummary,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listSupplierDebtSummaries(includeInactive: boolean): Promise<ListSupplierDebtSummariesResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/supplier-debt/summaries', { params: { query: { includeInactive: includeInactive ? 'true' : undefined } } }),
  ) as ListSupplierDebtSummariesResponse;
}

export async function getSupplierDebtSummary(supplierId: string): Promise<SupplierDebtSummary> {
  return unwrap(await getApiClient().GET('/api/v1/supplier-debt/{supplierId}/summary', { params: { path: { supplierId } } })) as SupplierDebtSummary;
}

export async function listSupplierDebtLedger(supplierId: string, query: ListSupplierDebtLedgerQuery): Promise<ListSupplierDebtLedgerResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/supplier-debt/{supplierId}/ledger', { params: { path: { supplierId }, query } }),
  ) as ListSupplierDebtLedgerResponse;
}

export async function listSupplierDebtReceipts(supplierId: string): Promise<ListSupplierDebtReceiptsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/supplier-debt/{supplierId}/receipts', { params: { path: { supplierId } } })) as ListSupplierDebtReceiptsResponse;
}

export async function recordSupplierDebtOpeningBalance(supplierId: string, body: RecordSupplierDebtOpeningBalanceRequest): Promise<SupplierDebtSummary> {
  return unwrap(
    await getApiClient().POST('/api/v1/supplier-debt/{supplierId}/opening-balance', { params: { path: { supplierId } }, body }),
  ) as SupplierDebtSummary;
}

export async function recordSupplierDebtPayment(supplierId: string, body: RecordSupplierDebtPaymentRequest): Promise<SupplierDebtSummary> {
  return unwrap(await getApiClient().POST('/api/v1/supplier-debt/{supplierId}/payment', { params: { path: { supplierId } }, body })) as SupplierDebtSummary;
}

export async function listSupplierDebtPayments(query: ListSupplierDebtPaymentsQuery): Promise<ListSupplierDebtPaymentsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/supplier-debt/payments', { params: { query } })) as ListSupplierDebtPaymentsResponse;
}

/** Phần C — "Thu tiền NCC hoàn lại" (Q8). */
export async function recordSupplierDebtRefund(supplierId: string, body: RecordSupplierDebtRefundRequest): Promise<SupplierDebtSummary> {
  return unwrap(await getApiClient().POST('/api/v1/supplier-debt/{supplierId}/refund', { params: { path: { supplierId } }, body })) as SupplierDebtSummary;
}

// ============ Phần D — "Luồng xử lý sai sót" (docs/DECISIONS.md #180/#182/#187) ============

/** Lập "Phiếu điều chỉnh công nợ" (INCREASE/DECREASE) hoặc "Đề nghị huỷ" (VOID_REQUEST). */
export async function createSupplierDebtAdjustment(body: CreateSupplierDebtAdjustmentRequest): Promise<SupplierDebtAdjustment> {
  return unwrap(await getApiClient().POST('/api/v1/supplier-debt/adjustments', { body })) as SupplierDebtAdjustment;
}

/** Dùng cho CẢ tab "Nhật ký điều chỉnh" (lọc `supplierId`) LẪN badge "Có điều chỉnh" trên phiếu
 * nhập/xuất gốc (lọc `targetReceiptId`/`targetIssueId`). */
export async function listSupplierDebtAdjustments(query: ListSupplierDebtAdjustmentsQuery): Promise<ListSupplierDebtAdjustmentsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/supplier-debt/adjustments', { params: { query } })) as ListSupplierDebtAdjustmentsResponse;
}

export async function approveSupplierDebtAdjustment(id: string, body: ApproveSupplierDebtAdjustmentRequest): Promise<SupplierDebtAdjustment> {
  return unwrap(await getApiClient().POST('/api/v1/supplier-debt/adjustments/{id}/approve', { params: { path: { id } }, body })) as SupplierDebtAdjustment;
}

export async function rejectSupplierDebtAdjustment(id: string, body: RejectSupplierDebtAdjustmentRequest): Promise<SupplierDebtAdjustment> {
  return unwrap(await getApiClient().POST('/api/v1/supplier-debt/adjustments/{id}/reject', { params: { path: { id } }, body })) as SupplierDebtAdjustment;
}

// ============ Phần E — "Đối chiếu & chốt công nợ theo kỳ" (docs/DECISIONS.md #182 câu 3) ============

export async function previewSupplierDebtReconciliation(supplierId: string, asOfDate: string, confirmedBalance: number): Promise<PreviewSupplierDebtReconciliationResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/supplier-debt/{supplierId}/reconciliation-preview', { params: { path: { supplierId }, query: { asOfDate, confirmedBalance } } }),
  ) as PreviewSupplierDebtReconciliationResponse;
}

export async function createSupplierDebtReconciliation(supplierId: string, body: CreateSupplierDebtReconciliationRequest): Promise<SupplierDebtReconciliation> {
  return unwrap(
    await getApiClient().POST('/api/v1/supplier-debt/{supplierId}/reconciliations', { params: { path: { supplierId } }, body }),
  ) as SupplierDebtReconciliation;
}

export async function listSupplierDebtReconciliations(supplierId: string): Promise<ListSupplierDebtReconciliationsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/supplier-debt/{supplierId}/reconciliations', { params: { path: { supplierId } } }),
  ) as ListSupplierDebtReconciliationsResponse;
}

export async function finalizeSupplierDebtReconciliation(supplierId: string, id: string, body: FinalizeSupplierDebtReconciliationRequest): Promise<SupplierDebtReconciliation> {
  return unwrap(
    await getApiClient().POST('/api/v1/supplier-debt/{supplierId}/reconciliations/{id}/finalize', { params: { path: { supplierId, id } }, body }),
  ) as SupplierDebtReconciliation;
}
