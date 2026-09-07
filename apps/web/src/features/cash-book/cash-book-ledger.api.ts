import type { CashBookLedgerResponse, GetCashBookLedgerQuery } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function getCashBookLedger(query: GetCashBookLedgerQuery): Promise<CashBookLedgerResponse> {
  return unwrap(await getApiClient().GET('/api/v1/cash-book/ledger', { params: { query } })) as CashBookLedgerResponse;
}
