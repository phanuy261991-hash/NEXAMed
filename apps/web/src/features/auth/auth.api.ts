import type { ChangePasswordRequest, ChangePasswordResponse, LoginResponse, MeResponse, RefreshResponse } from '@nexamed/shared';
import { getApiClient, setAccessToken, unwrap } from '../../shared/api/client';

export async function login(tenantId: string, username: string, password: string): Promise<LoginResponse> {
  const result = unwrap(
    await getApiClient().POST('/api/v1/auth/login', { body: { tenantId, username, password } }),
  ) as LoginResponse;
  setAccessToken(result.accessToken);
  return result;
}

export async function refresh(): Promise<RefreshResponse> {
  const result = unwrap(await getApiClient().POST('/api/v1/auth/refresh', {})) as RefreshResponse;
  setAccessToken(result.accessToken);
  return result;
}

export async function logout(): Promise<{ success: boolean }> {
  try {
    return unwrap(await getApiClient().POST('/api/v1/auth/logout', {}));
  } finally {
    setAccessToken(undefined);
  }
}

export async function getMe(): Promise<MeResponse> {
  return unwrap(await getApiClient().GET('/api/v1/auth/me', {})) as MeResponse;
}

/** Mở rộng ADM-01 — dùng cho cả luồng bắt buộc lần đầu (`mustChangePassword`) lẫn đổi tự nguyện. */
export async function changePassword(body: ChangePasswordRequest): Promise<ChangePasswordResponse> {
  return unwrap(await getApiClient().POST('/api/v1/auth/change-password', { body })) as ChangePasswordResponse;
}
