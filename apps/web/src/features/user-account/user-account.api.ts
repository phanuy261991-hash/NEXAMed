import type {
  CreateUserAccountRequest,
  ListUserAccountsResponse,
  ResetUserPasswordRequest,
  UpdateUserAccountRequest,
  UserAccountSummary,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listUserAccounts(params: { cursor?: string; limit?: number }): Promise<ListUserAccountsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/users', { params: { query: params } })) as ListUserAccountsResponse;
}

export async function createUserAccount(body: CreateUserAccountRequest): Promise<UserAccountSummary> {
  return unwrap(await getApiClient().POST('/api/v1/users', { body })) as UserAccountSummary;
}

export async function updateUserAccount(id: string, body: UpdateUserAccountRequest): Promise<UserAccountSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/users/{id}', { params: { path: { id } }, body })) as UserAccountSummary;
}

export async function resetUserPassword(id: string, body: ResetUserPasswordRequest): Promise<UserAccountSummary> {
  return unwrap(
    await getApiClient().POST('/api/v1/users/{id}/reset-password', { params: { path: { id } }, body }),
  ) as UserAccountSummary;
}
