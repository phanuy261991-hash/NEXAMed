import type { AppConfig } from '../../app/config';

/**
 * Wrapper `fetch` tối giản — chỉ đủ dùng cho luồng đăng nhập (login/refresh/logout/me) ở S1-08.
 * S1-09 sẽ thay bằng client sinh từ OpenAPI + TanStack Query (đúng phạm vi plan.md) — không mở
 * rộng thêm ở đây (không retry, không cache, không tự refresh khi 401 — S1-09 lo).
 */
let currentConfig: AppConfig | null = null;

/** Gọi đúng 1 lần ở `main.tsx` sau khi `loadAppConfig()` xong, trước khi render app. */
export function configureApiClient(config: AppConfig): void {
  currentConfig = config;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string;
}

/** Parse envelope `{data,meta}`/`{error}` theo .claude/docs/architecture.md. */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  if (!currentConfig) {
    throw new Error('apiFetch gọi trước khi configureApiClient() — kiểm tra thứ tự bootstrap trong main.tsx.');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const res = await fetch(`${currentConfig.apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    // Bắt buộc để cookie refresh_token (httpOnly, path=/api/v1/auth) tự gửi kèm request.
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const error = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(error?.code ?? 'UNKNOWN_ERROR', error?.message ?? `HTTP ${res.status}`, error?.details);
  }

  return (json as { data: T }).data;
}
