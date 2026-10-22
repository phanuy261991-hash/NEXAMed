import type {
  ChangePlatformTenantCodeResponse,
  CreatePlatformTenantRequest,
  CreatePlatformTenantResponse,
  ListPlatformAuditResponse,
  ListPlatformTenantsResponse,
  PlatformLoginResponse,
  PlatformOperator,
  PlatformSessionResponse,
  PlatformTenantDetail,
  ResetTenantAdminPasswordResponse,
  UpdatePlatformTenantRequest,
} from '@nexamed/shared';

/**
 * Gọi API khu quản trị nền tảng (docs/DECISIONS.md #237). Tách khỏi `shared/api/client.ts` (client của phòng khám): khu này dùng token người vận hành RIÊNG, không có làm mới phiên,
 * và nằm trên tên miền quản trị — client phòng khám sẽ cố làm mới token qua `/auth/refresh` khi gặp 401, không đúng ở đây. Chỉ nhập KIỂU từ `@nexamed/shared`.
 */
export class PlatformApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let baseUrl = '';
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function configurePlatformApi(apiBaseUrl: string, handlers: { onUnauthorized: () => void }): void {
  baseUrl = apiBaseUrl;
  onUnauthorized = handlers.onUnauthorized;
}

export function setPlatformToken(token: string | null): void {
  accessToken = token;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${baseUrl}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    // Token hết hạn/không hợp lệ (không phải lỗi đăng nhập) → về màn đăng nhập.
    if (res.status === 401 && accessToken && !path.startsWith('/platform/auth/')) onUnauthorized?.();
    throw new PlatformApiError(json?.error?.message ?? 'Có lỗi xảy ra, vui lòng thử lại.', json?.error?.code ?? 'UNKNOWN', res.status);
  }
  return json?.data as T;
}

export const platformLogin = (username: string, password: string) => call<PlatformLoginResponse>('POST', '/platform/auth/login', { username, password });
export const platformVerifyOtp = (mfaToken: string, code: string) => call<PlatformSessionResponse>('POST', '/platform/auth/verify-otp', { mfaToken, code });
export const platformMe = () => call<PlatformOperator>('GET', '/platform/auth/me');

export function listTenants(params: { q: string; status: 'all' | 'active' | 'suspended' }) {
  const query = new URLSearchParams({ status: params.status });
  if (params.q.trim()) query.set('q', params.q.trim());
  return call<ListPlatformTenantsResponse>('GET', `/platform/tenants?${query.toString()}`);
}
export const getTenant = (id: string) => call<PlatformTenantDetail>('GET', `/platform/tenants/${id}`);
export const createTenant = (body: CreatePlatformTenantRequest) => call<CreatePlatformTenantResponse>('POST', '/platform/tenants', body);
export const updateTenant = (id: string, body: UpdatePlatformTenantRequest) => call<PlatformTenantDetail>('PATCH', `/platform/tenants/${id}`, body);
export const suspendTenant = (id: string, version: number, reason: string) => call<PlatformTenantDetail>('POST', `/platform/tenants/${id}/suspend`, { version, reason });
export const unsuspendTenant = (id: string, version: number) => call<PlatformTenantDetail>('POST', `/platform/tenants/${id}/unsuspend`, { version });
export const changeTenantCode = (id: string, version: number, newCode: string, reason: string) =>
  call<ChangePlatformTenantCodeResponse>('POST', `/platform/tenants/${id}/change-code`, { version, newCode, reason });
export const resetTenantAdminPassword = (id: string) => call<ResetTenantAdminPasswordResponse>('POST', `/platform/tenants/${id}/reset-admin-password`);

export function listAuditLogs(params: { tenantId?: string; cursor?: string }) {
  const query = new URLSearchParams({ limit: '50' });
  if (params.tenantId) query.set('tenantId', params.tenantId);
  if (params.cursor) query.set('cursor', params.cursor);
  return call<ListPlatformAuditResponse>('GET', `/platform/audit-logs?${query.toString()}`);
}
