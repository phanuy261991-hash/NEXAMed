import type { LoginResponse, MeResponse } from '@nexamed/shared';
import { apiFetch } from '../../shared/api/client';

export function login(tenantId: string, username: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { tenantId, username, password },
  });
}

export function refresh(): Promise<{ accessToken: string; expiresIn: number }> {
  return apiFetch('/api/v1/auth/refresh', { method: 'POST' });
}

export function logout(): Promise<{ success: boolean }> {
  return apiFetch('/api/v1/auth/logout', { method: 'POST' });
}

export function getMe(accessToken: string): Promise<MeResponse> {
  return apiFetch<MeResponse>('/api/v1/auth/me', { accessToken });
}
