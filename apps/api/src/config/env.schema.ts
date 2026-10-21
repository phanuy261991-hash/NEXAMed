import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL là bắt buộc'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET phải có ít nhất 16 ký tự'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY phải có ít nhất 32 ký tự'),
  // CORS cho web dev (Vite mặc định 5173) — refresh token là cookie nên cần credentials:true +
  // origin tường minh (không dùng '*'). Xem apps/api/src/main.ts.
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Thư mục gốc lưu file của StoragePort (adapter local-disk, S1-06) — đặt ngoài web root theo
  // .claude/docs/security-audit.md. Đường dẫn tương đối tính từ thư mục chạy tiến trình API.
  STORAGE_DIR: z.string().min(1).default('./storage'),
  // Cờ `Secure` của cookie refresh token (S1-04) — KHÔNG suy ra từ NODE_ENV (phát hiện thật lúc
  // verify S4-05: on-prem PC/NAS mặc định chạy HTTP thuần, trình duyệt âm thầm bỏ qua cookie
  // Secure trên origin http:// khiến refresh hỏng không báo lỗi). Mặc định giữ hành vi cũ
  // (NODE_ENV==='production' → secure) khi không đặt biến này; đặt "false" tường minh cho bản
  // on-prem HTTP-only, "true" bắt buộc khi có TLS (VPS/cloud — xem docs/Deploy.md Phần 0.2).
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  // Số lớp reverse proxy ĐÁNG TIN đứng trước API (docs/DECISIONS.md #244). 0 (mặc định) = KHÔNG tin
  // `X-Forwarded-For`, lấy IP của kết nối trực tiếp — an toàn khi API mở thẳng ra mạng, vì nếu tin
  // mù quáng thì ai cũng tự khai IP giả để né giới hạn tần suất và làm sai nhật ký. Đặt 1 khi API
  // đứng sau ĐÚNG MỘT reverse proxy do mình quản (nginx của bản on-prem, hoặc proxy của SaaS) —
  // lúc đó giới hạn tần suất mới tính đúng theo từng máy trạm và nhật ký mới ghi đúng IP người dùng.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Đường dẫn file trạng thái sao lưu do `deploy/on-prem/backup/backup.sh` ghi ra (S6-01, ADM-04)
  // — CHỈ đặt ở bản on-prem thật (docker-compose.yml mount volume dùng chung với container
  // `backup`). Để trống (mặc định, đúng cho máy dev — không chạy container backup) thì
  // `GET /backup-status` trả `configured: false`, FE không hiện banner cảnh báo giả.
  BACKUP_STATUS_FILE: z.string().min(1).optional(),
  // Thư mục đích sao lưu TRÊN MÁY CHỦ (giá trị `BACKUP_HOST_DIR` trong `.env`) — chỉ để HIỂN THỊ ở "Cấu hình hệ thống → Sao lưu dữ liệu" (#217); API không đổi được điểm gắn của container.
  BACKUP_HOST_DIR_DISPLAY: z.string().min(1).optional(),
  // Đường dẫn thực thi Chrome/Chromium cho xuất bệnh án PDF (S6-06, ADM-05, `PuppeteerPdfRendererAdapter`).
  // Để trống thì adapter tự dò /usr/bin/chromium (đúng gói `apt-get install chromium` trong
  // apps/api/Dockerfile) — đủ cho container Docker. Máy dev Windows PHẢI đặt tường minh, trỏ tới
  // Chrome cài sẵn (vd C:\Program Files\Google\Chrome\Application\chrome.exe).
  CHROMIUM_EXECUTABLE_PATH: z.string().min(1).optional(),
  // Quản lý phiên bản (docs/DECISIONS.md #236) — ảnh Docker truyền lúc dựng (`build-and-export.ps1`); để trống ở máy phát triển (phiên bản lấy từ package.json gốc, kênh `dev`).
  APP_VERSION: z.string().min(1).optional(),
  BUILD_ID: z.string().min(1).optional(),
  RELEASE_CHANNEL: z.enum(['stable', 'beta', 'dev']).optional(),
  RELEASED_AT: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // `single` = một công ty trên một hệ thống riêng (on-prem/VPS/NAS, mặc định); `saas` = nhiều công ty dùng chung (Đợt 4). Một mã nguồn, hai chế độ.
  DEPLOYMENT_MODE: z.enum(['single', 'saas']).default('single'),
  // Địa chỉ máy chủ phát hành (nơi đặt `manifest.json`) để KIỂM TRA bản mới (#236, bước 2). Do nhà cung cấp đặt lúc bàn giao — không có endpoint/giao diện cho khách nhập. Chuỗi rỗng (docker-compose truyền `${…:-}`) coi như chưa đặt.
  RELEASE_SERVER_URL: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().url().optional()),
  // Chế độ SaaS (#237): tên miền gốc (mỗi công ty là một tên miền phụ `<mã>.<tên miền gốc>`, khu quản trị ở `<PLATFORM_ADMIN_SUBDOMAIN>.<tên miền gốc>`). Bắt buộc khi DEPLOYMENT_MODE=saas; chế độ một công ty bỏ qua.
  PLATFORM_BASE_DOMAIN: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().min(3).optional()),
  PLATFORM_ADMIN_SUBDOMAIN: z.string().trim().min(1).default('admin'),
  // Khoá của NHÀ CUNG CẤP PHẦN MỀM do đơn vị vận hành cổng Đơn thuốc quốc gia cấp (#242 GĐ3) — chỉ cần cho API nhà thuốc (lấy đơn, báo số lượng bán, làm sau). Cài ở máy chủ, KHÔNG nhập trên giao diện, không lưu DB; giao diện chỉ hiện "đã/chưa cấu hình".
  INTEROP_APP_NAME: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().min(1).optional()),
  INTEROP_APP_KEY: z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().min(1).optional()),
}).superRefine((env, ctx) => {
  if (env.DEPLOYMENT_MODE === 'saas' && !env.PLATFORM_BASE_DOMAIN) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PLATFORM_BASE_DOMAIN'], message: 'PLATFORM_BASE_DOMAIN là bắt buộc khi DEPLOYMENT_MODE=saas' });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Cấu hình biến môi trường không hợp lệ:\n${details}`);
  }
  return result.data;
}