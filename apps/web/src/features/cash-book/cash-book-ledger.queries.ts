import { useQuery } from '@tanstack/react-query';
import type { GetCashBookLedgerQuery } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getCashBookLedger } from './cash-book-ledger.api';

export function useCashBookLedgerQuery(query: GetCashBookLedgerQuery, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'cash-book-ledger', JSON.stringify(query)),
    queryFn: () => getCashBookLedger(query),
    enabled: enabled && query.cashAccountId !== '',
  });
}
