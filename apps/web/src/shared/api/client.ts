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
let sessionExpiredHandler: (() => void) | undefined;

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

/**
 * Gọi 1 lần ở `AppBootstrap` — dọn phiên (điều hướng `/login` qua `RequireAuth`) khi access token
 * đã hết hạn (15 phút, `.claude/docs/security-audit.md`) VÀ refresh token (cookie) cũng không còn
 * dùng được. Đặt ở đây (thay vì import thẳng `auth.store`) để giữ chiều phụ thuộc `shared` không
 * biết tới `features` cụ thể — đúng `.claude/docs/project-structure.md`.
 */
export function setSessionExpiredHandler(handler: () => void): void {
  sessionExpiredHandler = handler;
}

/** `/auth/refresh`, `/auth/login` không được kích hoạt lại vòng làm mới token — tránh lặp vô hạn. */
function isAuthTokenEndpoint(url: string): boolean {
  return url.includes('/api/v1/auth/refresh') || url.includes('/api/v1/auth/login');
}

/** Bản sao request CHƯA gửi, lưu theo `id` — request body chỉ đọc được một lần nên phải clone
 * TRƯỚC khi fetch thật sự tiêu thụ nó, để có thể thử lại đúng 1 lần sau khi làm mới token. */
const pendingRetryClones = new Map<string, Request>();

let refreshPromise: Promise<string | null> | null = null;

/**
 * Làm mới access token qua cookie refresh (httpOnly). Dedupe: nhiều request 401 gần như đồng thời
 * (ví dụ vài query cùng fetch lúc quay lại tab sau khi để lâu) chỉ gọi `/auth/refresh` đúng một
 * lần, tất cả cùng chờ chung promise thay vì mỗi request tự rotate token của nhau.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const result = await client.POST('/api/v1/auth/refresh', {});
        const data = unwrap<{ accessToken: string }>(result);
        setAccessToken(data.accessToken);
        return data.accessToken;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * Access token 15 phút hết hạn giữa chừng (để tab yên không thao tác, hoặc đang gõ sau một lúc
 * rời đi) trước đây trả thẳng `401` lên UI ("Không tải được dữ liệu") vì không có gì làm mới token
 * — sửa bằng cách tự làm mới + thử lại đúng 1 lần ở tầng client, UI không cần biết chuyện này xảy
 * ra. Refresh thất bại (cookie refresh cũng hết hạn/không hợp lệ) thì mới coi là hết phiên thật.
 */
const authMiddleware: Middleware = {
  onRequest({ request, id }) {
    if (currentAccessToken) {
      request.headers.set('Authorization', `Bearer ${currentAccessToken}`);
    }
    if (!isAuthTokenEndpoint(request.url)) {
      pendingRetryClones.set(id, request.clone());
    }
    return request;
  },
  async onResponse({ request, response, id }) {
    const retryClone = pendingRetryClones.get(id);
    pendingRetryClones.delete(id);

    if (response.status !== 401 || !retryClone || isAuthTokenEndpoint(request.url)) {
      return undefined;
    }

    const newToken = await refreshAccessToken();
    if (!newToken) {
      sessionExpiredHandler?.();
      return undefined;
    }

    retryClone.headers.set('Authorization', `Bearer ${newToken}`);
    return fetch(retryClone);
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

/**
 * Ghép `apiBaseUrl` vào đường dẫn tương đối server trả về (ví dụ `photoUrl`/`logoUrl` dạng
 * `/api/v1/files/<token>` từ `signFileToken`, xem `apps/api/src/infrastructure/storage/
 * signed-url.ts`) — BUG THẬT phát hiện lúc kiểm bằng trình duyệt (2026-08-13): `<img src="/api/
 * v1/files/...">` bị trình duyệt phân giải theo origin của TRANG WEB (`apiBaseUrl` khác origin ở
 * mọi môi trường thật — dev 5173≠3000, on-prem qua nginx cũng tách domain/path riêng), Vite dev
 * server lại tự trả `index.html` (SPA fallback) cho path lạ thay vì 404 — ảnh vỡ âm thầm, không
 * console error rõ ràng. Ảnh hưởng CẢ `PatientAvatarUpload.tsx` có sẵn (docs/DECISIONS.md #034)
 * lẫn logo phòng khám mới — sửa 1 chỗ dùng chung thay vì vá riêng từng nơi.
 */
export function resolveApiUrl(path: string): string {
  if (!currentConfig) {
    throw new Error('resolveApiUrl() gọi trước khi configureApiClient().');
  }
  return path.startsWith('http://') || path.startsWith('https://') ? path : `${currentConfig.apiBaseUrl}${path}`;
}

/** Truy cập client đã cấu hình `baseUrl`/cookie/Authorization — dùng trong `*.api.ts` của từng feature. */
export function getApiClient() {
  if (!currentConfig) {
    throw new Error('getApiClient() gọi trước khi configureApiClient() — kiểm tra thứ tự bootstrap trong main.tsx.');
  }
  return client;
}

/**
 * Upload `multipart/form-data` — `openapi-fetch` không tự serialize `FormData` (chỉ JSON.stringify
 * body mặc định), nên endpoint upload file (ảnh đại diện bệnh nhân, docs/DECISIONS.md #034) gọi
 * `fetch` trực tiếp thay vì qua `getApiClient()`. Không có retry-on-401 tự động như
 * `authMiddleware` (chấp nhận được — ảnh không phải luồng chính, hết phiên giữa lúc upload thì
 * người dùng thử lại là đủ, không đáng thêm độ phức tạp dùng chung cho một chỗ gọi duy nhất).
 */
export async function uploadFile<T>(path: string, formData: FormData): Promise<T> {
  if (!currentConfig) {
    throw new Error('uploadFile() gọi trước khi configureApiClient().');
  }
  const response = await fetch(`${currentConfig.apiBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : undefined,
    body: formData,
  });
  const body: unknown = await response.json();
  return response.ok
    ? unwrap<T>({ data: body as Envelope<T> })
    : unwrap<T>({ error: body as ErrorEnvelope });
}

/**
 * Tải file nhị phân (Excel mẫu/xuất) — không qua envelope `{data,meta}`, cùng lý do `uploadFile`
 * không dùng `openapi-fetch`. `filenameFallback` dùng khi server không trả `Content-Disposition`
 * (không nên xảy ra, phòng vệ). Kích hoạt tải bằng thẻ `<a>` ẩn — trình duyệt thật (không phải
 * artifact sandbox) nên không bị chặn.
 */
export async function downloadFile(path: string, filenameFallback: string): Promise<void> {
  if (!currentConfig) {
    throw new Error('downloadFile() gọi trước khi configureApiClient().');
  }
  const response = await fetch(`${currentConfig.apiBaseUrl}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : undefined,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const err = (body as ErrorEnvelope | null)?.error;
    throw new ApiError(err?.code ?? 'UNKNOWN_ERROR', err?.message ?? 'Không tải được file.', err?.details);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? filenameFallback;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
