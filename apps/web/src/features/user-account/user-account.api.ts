import type {
  CreateUserAccountRequest,
  ListUserAccountsResponse,
  ResetUserPasswordRequest,
  UpdateUserAccountRequest,
  UserAccountSummary,
} from '@nexamed/shared';
import { getApiClient, unwrap, uploadFile } from '../../shared/api/client';

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

/** Upload/thay ảnh chữ ký (redesign 3-tab, #082) — multipart, cùng khuôn `uploadPatientPhoto`. */
export async function uploadUserAccountSignature(id: string, file: File, version: number): Promise<UserAccountSummary> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('version', String(version));
  return uploadFile<UserAccountSummary>(`/api/v1/users/${id}/signature`, formData);
}
