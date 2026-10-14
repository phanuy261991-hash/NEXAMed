import type { CashAccount, CreateCashAccountRequest, ListCashAccountsResponse, UpdateCashAccountRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** `allBranches`: mọi chi nhánh tài khoản được gán (màn quản trị Quỹ); mặc định chỉ quỹ của chi nhánh đang làm việc (docs/DECISIONS.md #233). */
export async function getCashAccounts(allBranches = false): Promise<ListCashAccountsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/cash-accounts', { params: { query: allBranches ? { allBranches: true } : {} } })) as ListCashAccountsResponse;
}

export async function createCashAccount(body: CreateCashAccountRequest): Promise<CashAccount> {
  return unwrap(await getApiClient().POST('/api/v1/cash-accounts', { body })) as CashAccount;
}

export async function updateCashAccount(id: string, body: UpdateCashAccountRequest): Promise<CashAccount> {
  return unwrap(await getApiClient().PATCH('/api/v1/cash-accounts/{id}', { params: { path: { id } }, body })) as CashAccount;
}
