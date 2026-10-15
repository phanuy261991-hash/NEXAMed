import { z } from 'zod';

/**
 * Cấu hình runtime của web app — nạp từ `/config.json` (file tĩnh trong `public/`, Vite copy
 * nguyên vào `dist/` lúc build). Sửa trực tiếp file này trên server on-prem sau khi deploy
 * không cần build lại — xem docs/DECISIONS.md #020, apps/web/public/config.example.json.
 *
 * Hai chế độ cùng một mã nguồn (docs/DECISIONS.md #237):
 * - **Một công ty** (on-prem/VPS/NAS, như mọi bản đã giao khách): `config.json` có `tenantId` → dùng ngay, KHÔNG gọi thêm máy chủ.
 * - **SaaS**: `config.json` không có `tenantId` → công ty lấy từ TÊN MIỀN PHỤ đang truy cập qua `GET /api/v1/public/tenant-context`
 *   (cùng địa chỉ với giao diện, `apiBaseUrl` bỏ trống = cùng nguồn gốc). Tên miền quản trị nền tảng → khu quản trị; tên lạ → "Không tìm thấy công ty".
 */
const rawConfigSchema = z.object({
  apiBaseUrl: z.string().optional(),
  tenantId: z.string().uuid().optional(),
});

/** Công ty đang truy cập (chỉ có ở chế độ SaaS) — màn đăng nhập hiện tên công ty và báo khi đang tạm ngưng. */
export interface CompanyInfo {
  name: string;
  code: string;
  suspended: boolean;
}

export interface AppConfig {
  apiBaseUrl: string;
  tenantId: string;
  /** Chỉ có ở chế độ SaaS; chế độ một công ty để trống. */
  company?: CompanyInfo;
}

export type BootstrapResult =
  | { kind: 'clinic'; config: AppConfig }
  | { kind: 'platform'; apiBaseUrl: string }
  | { kind: 'company_not_found' };

const tenantContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tenant'), tenantId: z.string().uuid(), name: z.string(), code: z.string(), suspended: z.boolean() }),
  z.object({ kind: z.literal('platform') }),
]);

export async function resolveBootstrap(): Promise<BootstrapResult> {
  const res = await fetch('/config.json');
  if (!res.ok) {
    throw new Error(`Không tải được /config.json (HTTP ${res.status}). Xem apps/web/public/config.example.json.`);
  }
  const raw: unknown = await res.json();
  const parsed = rawConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`/config.json không hợp lệ: ${parsed.error.message}`);
  }
  const apiBaseUrl = parsed.data.apiBaseUrl?.trim() || window.location.origin;

  if (parsed.data.tenantId) {
    return { kind: 'clinic', config: { apiBaseUrl, tenantId: parsed.data.tenantId } };
  }

  // Chế độ SaaS: hỏi máy chủ "tên miền này là công ty nào".
  const contextRes = await fetch(`${apiBaseUrl}/api/v1/public/tenant-context`, { credentials: 'include' });
  if (contextRes.status === 404) return { kind: 'company_not_found' };
  if (!contextRes.ok) {
    throw new Error(`Không xác định được công ty từ địa chỉ truy cập (HTTP ${contextRes.status}). Thử lại sau hoặc liên hệ nhà cung cấp.`);
  }
  const body = (await contextRes.json()) as { data?: unknown };
  const context = tenantContextSchema.safeParse(body.data);
  if (!context.success) {
    throw new Error('Máy chủ trả về thông tin công ty không hợp lệ.');
  }
  if (context.data.kind === 'platform') return { kind: 'platform', apiBaseUrl };
  return {
    kind: 'clinic',
    config: { apiBaseUrl, tenantId: context.data.tenantId, company: { name: context.data.name, code: context.data.code, suspended: context.data.suspended } },
  };
}
