import createClient, { type Middleware } from 'openapi-fetch';
import type { AppConfig } from '../../app/config';
import { friendlyApiMessage, resolveApiErrorCode } from './api-message';
import { IDEMPOTENCY_KEY_HEADER, createIdempotencyKeyStore, shouldAttachIdempotencyKey } from './idempotency-key';
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

/** Đọc access token hiện tại — dùng cho `fetch()` tay ngoài `getApiClient()`/`downloadFile()` (ví
 * dụ tải nhị phân qua POST kèm body, S6-06), tránh mở rộng `downloadFile()` (đè nặng chunk khởi
 * động — mọi *.api.ts của route đã lazy đều import `client.ts` qua `getApiClient()`). */
export function getAccessToken(): string | undefined {
  return currentAccessToken;
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

/**
 * Khoá chống ghi trùng (docs/DECISIONS.md #257): mọi POST JSON tự mang `Idempotency-Key`; cùng thao tác (cùng địa chỉ + nội dung) bấm lại thì dùng lại khoá cũ cho tới khi có kết luận.
 * `idempotencyFingerprints` nhớ thao tác của từng request đang bay (theo `id` của openapi-fetch) để báo kết luận khi có phản hồi.
 */
const idempotencyKeys = createIdempotencyKeyStore();
const idempotencyFingerprints = new Map<string, string>();

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
  async onRequest({ request, id }) {
    if (currentAccessToken) {
      request.headers.set('Authorization', `Bearer ${currentAccessToken}`);
    }
    // Gắn khoá TRƯỚC khi clone để lần thử lại sau khi làm mới phiên (bên dưới) mang cùng khoá.
    if (shouldAttachIdempotencyKey(request.method, request.url, request.headers.get('Content-Type'))) {
      const fingerprint = `${request.method} ${request.url}
${await request.clone().text()}`;
      request.headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKeys.acquire(fingerprint));
      idempotencyFingerprints.set(id, fingerprint);
    }
    if (!isAuthTokenEndpoint(request.url)) {
      pendingRetryClones.set(id, request.clone());
    }
    return request;
  },
  async onResponse({ request, response, id }) {
    const retryClone = pendingRetryClones.get(id);
    pendingRetryClones.delete(id);
    const fingerprint = idempotencyFingerprints.get(id);
    idempotencyFingerprints.delete(id);

    if (response.status !== 401 || !retryClone || isAuthTokenEndpoint(request.url)) {
      if (fingerprint) idempotencyKeys.settle(fingerprint, response.status);
      return undefined;
    }

    const newToken = await refreshAccessToken();
    if (!newToken) {
      sessionExpiredHandler?.();
      if (fingerprint) idempotencyKeys.settle(fingerprint, response.status);
      return undefined;
    }

    retryClone.headers.set('Authorization', `Bearer ${newToken}`);
    // Thử lại cùng khoá: lần đầu 401 thì chưa chạy gì nên lần này chạy bình thường, và không bao giờ ghi hai lần. Mất mạng đúng lúc này thì `fetch` ném lỗi trước khi `settle`
    // → khoá được GIỮ, người dùng bấm lại vẫn an toàn.
    const retried = await fetch(retryClone);
    if (fingerprint) idempotencyKeys.settle(fingerprint, retried.status);
    return retried;
  },
  /** Mất mạng / fetch thất bại: không có phản hồi để báo kết luận — chỉ dọn bản ghi nhớ của request này; khoá vẫn được giữ cho lần bấm lại. */
  onError({ id }) {
    idempotencyFingerprints.delete(id);
    pendingRetryClones.delete(id);
    return undefined;
  },
};

let client = createClient<paths>({ baseUrl: '', credentials: 'include' });

/**
 * `message` LUÔN đã qua `friendlyApiMessage` (docs/DECISIONS.md #255) — là câu tiếng Việt dùng được cho người dùng cuối, không bao giờ là
 * thông điệp thô/tiếng Anh của máy chủ hay proxy. `status` là mã HTTP khi lỗi đến từ một phản hồi thật (để phân biệt lỗi nghiệp vụ 4xx với
 * lỗi hệ thống 5xx); thiếu khi lỗi do phía giao diện tự tạo.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Dựng `ApiError` từ một phản hồi HTTP KHÔNG thành công mà không đi qua `openapi-fetch` (tải/tải lên tệp, xuất bệnh án) — thân phản hồi có thể
 * không phải JSON (trang HTML 502/413 của nginx...), nên đọc an toàn rồi chuẩn hoá thông điệp theo mã HTTP.
 */
export async function apiErrorFromResponse(response: Response, fallbackMessage?: string): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const err = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  return new ApiError(resolveApiErrorCode(response.status, err?.code), friendlyApiMessage(response.status, err?.message, fallbackMessage), err?.details, response.status);
}

/**
 * Lỗi MẤT MẠNG thật (fetch không tới được server — DNS/CORS/timeout/offline) khác lỗi NGHIỆP VỤ
 * server đã trả lời (`ApiError`, ví dụ 400/403/409). `unwrap()` chỉ ném `ApiError` khi có phản hồi
 * HTTP thật; `fetch` thất bại trước khi có phản hồi ném `TypeError`/`DOMException` thô, không đi
 * qua `unwrap()`. Dùng để quyết định có nên lưu nháp offline (ENC-06, `shared/hooks/
 * useOnlineRetry.ts`) hay hiện lỗi nghiệp vụ bình thường như cũ.
 */
export function isNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError);
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
  // `data:` (ảnh minh hoạ nhúng sẵn, vd. bản xem trước mẫu in) giữ nguyên, không ghép địa chỉ API.
  return path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') ? path : `${currentConfig.apiBaseUrl}${path}`;
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
  if (!response.ok) throw await apiErrorFromResponse(response, 'Không tải lên được.');
  return unwrap<T>({ data: (await response.json()) as Envelope<T> });
}

/**
 * Tải file nhị phân (Excel mẫu/xuất, PDF...) — không qua envelope `{data,meta}`, cùng lý do
 * `uploadFile` không dùng `openapi-fetch`. `filenameFallback` dùng khi server không trả
 * `Content-Disposition` (không nên xảy ra, phòng vệ). Kích hoạt tải bằng thẻ `<a>` ẩn — trình
 * duyệt thật (không phải artifact sandbox) nên không bị chặn.
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
  if (!response.ok) throw await apiErrorFromResponse(response, 'Không tải được file.');
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

/**
 * Bóc `{data,meta}` thành `T`, hoặc ném `ApiError` — theo .claude/docs/architecture.md. Mã HTTP lấy từ `response` của `openapi-fetch` (callers truyền
 * nguyên `result`): lỗi nào cũng được chuẩn hoá thông điệp theo mã HTTP, KHÔNG đưa nguyên `message` của máy chủ lên giao diện (docs/DECISIONS.md #255).
 */
export function unwrap<T>(result: { data?: Envelope<T>; error?: ErrorEnvelope; response?: { status: number } }): T {
  const status = result.response?.status;
  if (result.error !== undefined || (status !== undefined && status >= 400)) {
    // `error` có thể là chuỗi/HTML (proxy trả trang lỗi) chứ không phải `{error:{...}}` — đọc phòng thủ.
    const err = typeof result.error === 'object' && result.error !== null ? result.error.error : undefined;
    throw new ApiError(resolveApiErrorCode(status, err?.code), friendlyApiMessage(status, err?.message), err?.details, status);
  }
  if (!result.data) {
    throw new ApiError('UNKNOWN_ERROR', 'Không nhận được dữ liệu từ máy chủ.', undefined, status);
  }
  return result.data.data;
}
