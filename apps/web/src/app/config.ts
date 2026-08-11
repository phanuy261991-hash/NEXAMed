import { z } from 'zod';

/**
 * Cấu hình runtime của web app — nạp từ `/config.json` (file tĩnh trong `public/`, Vite copy
 * nguyên vào `dist/` lúc build). Sửa trực tiếp file này trên server on-prem sau khi deploy
 * không cần build lại — xem docs/DECISIONS.md #020, apps/web/public/config.example.json.
 */
const appConfigSchema = z.object({
  apiBaseUrl: z.string().url(),
  tenantId: z.string().uuid(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export async function loadAppConfig(): Promise<AppConfig> {
  const res = await fetch('/config.json');
  if (!res.ok) {
    throw new Error(`Không tải được /config.json (HTTP ${res.status}). Xem apps/web/public/config.example.json.`);
  }
  const raw: unknown = await res.json();
  const parsed = appConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`/config.json không hợp lệ: ${parsed.error.message}`);
  }
  return parsed.data;
}
