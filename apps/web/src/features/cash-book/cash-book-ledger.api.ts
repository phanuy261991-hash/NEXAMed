import type { CashBookLedgerResponse, GetCashBookLedgerQuery, ListCashAccountsResponse } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../shared/api/client';

export async function getCashBookLedger(query: GetCashBookLedgerQuery): Promise<CashBookLedgerResponse> {
  return unwrap(await getApiClient().GET('/api/v1/cash-book/ledger', { params: { query } })) as CashBookLedgerResponse;
}

/** Xuất Excel — tải file thô qua `downloadFile()`, đúng khuôn `cash-flow-report.api.ts#exportCashFlowReport`. */
export async function exportCashBookLedger(query: GetCashBookLedgerQuery): Promise<void> {
  const from = query.from ?? 'tat-ca';
  const to = query.to ?? 'tat-ca';
  await downloadFile(
    `/api/v1/cash-book/ledger/export?cashAccountId=${query.cashAccountId}${query.from ? `&from=${query.from}` : ''}${query.to ? `&to=${query.to}` : ''}`,
    `so-quy-${from}_${to}.xlsx`,
  );
}

/**
 * Quỹ chọn được ở Sổ quỹ: `scope='current'` = quỹ chi nhánh đang làm; `'all'` = quỹ mọi chi nhánh (cần `company_report.read`, Đợt 3 #235). Dùng chung kiểu `CashAccount`
 * với màn quản trị quỹ nên dòng đã có sẵn `branchId`/`branchName`.
 */
export async function getCashBookLedgerAccounts(scope: 'current' | 'all'): Promise<ListCashAccountsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/cash-book/ledger/accounts', { params: { query: { scope } } })) as ListCashAccountsResponse;
}
