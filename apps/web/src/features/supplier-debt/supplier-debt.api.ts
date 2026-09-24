import type {
  ListSupplierDebtLedgerQuery,
  ListSupplierDebtLedgerResponse,
  ListSupplierDebtReceiptsResponse,
  ListSupplierDebtSummariesResponse,
  RecordSupplierDebtOpeningBalanceRequest,
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
