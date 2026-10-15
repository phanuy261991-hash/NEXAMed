import { z } from 'zod';

/**
 * Quản lý phiên bản phần mềm (docs/DECISIONS.md #236) — hợp đồng giữa máy chủ, web và script phát hành.
 * `stable` = kênh dành cho khách; `beta` = thử nghiệm; `dev` = máy phát triển (không có số bản dựng thật).
 */
export const RELEASE_CHANNELS = ['stable', 'beta', 'dev'] as const;
export const releaseChannelSchema = z.enum(RELEASE_CHANNELS);
export type ReleaseChannel = z.infer<typeof releaseChannelSchema>;

/** `single` = một công ty trên một hệ thống riêng (máy chủ tại cơ sở, VPS khách thuê, NAS); `saas` = nhiều công ty dùng chung (Đợt 4). */
export const DEPLOYMENT_MODES = ['single', 'saas'] as const;
export const deploymentModeSchema = z.enum(DEPLOYMENT_MODES);
export type DeploymentMode = z.infer<typeof deploymentModeSchema>;

const noteLineSchema = z.string().trim().min(1).max(300);

/**
 * Ghi chú phát hành của MỘT phiên bản — file `apps/api/release-notes/<phiên bản>.json`, bắt buộc có trước khi phát hành (script `scripts/release.mjs` kiểm). Nhóm theo
 * "Tính năng mới / Cải tiến / Sửa lỗi", viết cho người dùng cuối (không phải nhật ký kỹ thuật).
 */
export const releaseNotesSchema = z.object({
  version: z.string().min(1),
  releasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  features: z.array(noteLineSchema).max(50),
  improvements: z.array(noteLineSchema).max(50),
  fixes: z.array(noteLineSchema).max(50),
});
export type ReleaseNotes = z.infer<typeof releaseNotesSchema>;

/**
 * `GET /system/version` — công khai (không cần đăng nhập, như `/health`) để trang đăng nhập và kiểm tra lệch phiên bản dùng được; CHỈ chứa thông tin phiên bản, không cấu hình nhạy cảm.
 * `build` = số thứ tự bản dựng (số commit của nhánh lúc dựng, ví dụ `127`; `dev` ở máy phát triển), `schemaVersion` = migration cơ sở dữ liệu đã áp mới nhất (đọc thật từ DB, `null` nếu không đọc được).
 */
export const systemVersionSchema = z.object({
  version: z.string(),
  build: z.string(),
  channel: releaseChannelSchema,
  releasedAt: z.string().nullable(),
  deploymentMode: deploymentModeSchema,
  schemaVersion: z.string().nullable(),
  notes: releaseNotesSchema.nullable(),
});
export type SystemVersion = z.infer<typeof systemVersionSchema>;
