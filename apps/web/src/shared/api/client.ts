import createClient, { type Middleware } from 'openapi-fetch';
import type { AppConfig } from '../../app/config';
import type { paths } from './openapi-schema';

/**
 * Client HTTP sinh từ OpenAPI (`apps/api/openapi/openapi.json`, sinh từ Zod schema ở
 * `@nexamed/shared` — xem `apps/api/scripts/generate-openapi.ts`). Thay thế wrapper `fetch` tự
 * viết ở S1-08 (S1-09, xem docs/DECISIONS.md). Chạy `pnpm --filter @nexamed/web run api:codegen`
 * sau khi `pnpm --filter @nexamed/api run openapi:generate` để cập nhật type khi contract đổi.
 */
let currentConfig: AppConfig | null = null;
let currentAccessToken: string | undefined;

/** Gọi đúng 1 lần ở `main.tsx` sau khi `loadAppConfig()` xong, trước khi render app. */
export function configureApiClient(config: AppConfig): void {
  currentConfig = config;
  client = createClient<paths>({ baseUrl: config.apiBaseUrl, credentials: 'include' });
  client.use(authMiddleware);
}

/** Gọi mỗi khi phiên đăng nhập đổi (login/refresh/logout) — xem `auth.store.ts`. */
export function setAccessToken(token: string | undefined): void {
  currentAccessToken = token;
}

const authMiddleware: Middleware = {
  onRequest({ request }) {
    if (currentAccessToken) {
      request.headers.set('Authorization', `Bearer ${currentAccessToken}`);
    }
    return request;
  },
};

let client = createClient<paths>({ baseUrl: '', credentials: 'include' });

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

/** Truy cập client đã cấu hình `baseUrl`/cookie/Authorization — dùng trong `*.api.ts` của từng feature. */
export function getApiClient() {
  if (!currentConfig) {
    throw new Error('getApiClient() gọi trước khi configureApiClient() — kiểm tra thứ tự bootstrap trong main.tsx.');
  }
  return client;
}

interface Envelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

/** Bóc `{data,meta}` thành `T`, hoặc ném `ApiError` từ `{error}` — theo .claude/docs/architecture.md. */
export function unwrap<T>(result: { data?: Envelope<T>; error?: ErrorEnvelope }): T {
  if (result.error) {
    const err = result.error.error;
    throw new ApiError(err?.code ?? 'UNKNOWN_ERROR', err?.message ?? 'Có lỗi xảy ra, vui lòng thử lại.', err?.details);
  }
  if (!result.data) {
    throw new ApiError('UNKNOWN_ERROR', 'Không nhận được dữ liệu từ server.');
  }
  return result.data.data;
}
