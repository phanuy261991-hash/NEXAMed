import type { CashAccount, CreateCashAccountRequest, ListCashAccountsResponse, UpdateCashAccountRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function getCashAccounts(): Promise<ListCashAccountsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/cash-accounts')) as ListCashAccountsResponse;
}

export async function createCashAccount(body: CreateCashAccountRequest): Promise<CashAccount> {
  return unwrap(await getApiClient().POST('/api/v1/cash-accounts', { body })) as CashAccount;
}

export async function updateCashAccount(id: string, body: UpdateCashAccountRequest): Promise<CashAccount> {
  return unwrap(await getApiClient().PATCH('/api/v1/cash-accounts/{id}', { params: { path: { id } }, body })) as CashAccount;
}
