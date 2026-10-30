import { z } from 'zod';
import { releaseNotesSchema } from './system-version';

/**
 * Kiểm tra cập nhật phần mềm (docs/DECISIONS.md #236, bước 2) — hợp đồng giữa máy chủ phát hành (file khai báo), máy chủ ứng dụng và web.
 * Chỉ KIỂM TRA và HIỂN THỊ; bộ cập nhật thật (sao lưu, tải ảnh, migrate, quay lui) là bước sau.
 */

/** Biểu thức SemVer 2.0 — NGUỒN DUY NHẤT, `packages/core` (`parseSemver`) và schema dưới đây cùng dùng. */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const semverStringSchema = z.string().regex(SEMVER_PATTERN, 'Phiên bản phải theo SemVer, ví dụ 0.9.0');

/** Một bản phát hành trên một kênh, đúng như máy chủ phát hành công bố. */
export const releaseEntrySchema = z.object({
  version: semverStringSchema,
  releasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: releaseNotesSchema.pick({ features: true, improvements: true, fixes: true }),
  /** Bản này có thay đổi cơ sở dữ liệu (migration) — hiện cảnh báo nên sao lưu trước khi cập nhật. */
  requiresMigration: z.boolean().default(false),
  /** Phiên bản thấp nhất được nâng THẲNG lên bản này; thấp hơn phải qua bản trung gian này trước. */
  minimumFromVersion: semverStringSchema.optional(),
});
export type ReleaseEntry = z.infer<typeof releaseEntrySchema>;

/**
 * File khai báo phát hành `<máy chủ phát hành>/manifest.json`. Mỗi kênh có tối đa một bản mới nhất; kênh chưa có bản nào thì bỏ trống.
 * `schemaVersion` để đổi định dạng file sau này mà bộ kiểm tra cũ vẫn nhận ra và báo lỗi rõ ràng thay vì hiểu sai.
 */
export const releaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  channels: z.object({
    stable: releaseEntrySchema.optional(),
    beta: releaseEntrySchema.optional(),
  }),
});
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

/** Kênh dùng để hỏi máy chủ phát hành: máy phát triển (`dev`) hỏi như kênh Ổn định. */
export const updateChannelSchema = z.enum(['stable', 'beta']);
export type UpdateChannel = z.infer<typeof updateChannelSchema>;

export const UPDATE_CHECK_STATES = ['not_configured', 'never_checked', 'up_to_date', 'update_available', 'error'] as const;
export const updateCheckStateSchema = z.enum(UPDATE_CHECK_STATES);
export type UpdateCheckState = z.infer<typeof updateCheckStateSchema>;

export const updateCheckHistoryItemSchema = z.object({
  at: z.string(),
  byName: z.string().nullable(),
  result: z.enum(['up_to_date', 'update_available', 'error']),
  latestVersion: z.string().nullable(),
});
export type UpdateCheckHistoryItem = z.infer<typeof updateCheckHistoryItemSchema>;

/**
 * `GET /system/update/status` và kết quả của `POST /system/update/check`. `state` suy từ lần kiểm tra GẦN NHẤT (lưu trong bộ nhớ máy chủ, tự làm mới định kỳ khi đã cấu hình máy chủ phát hành):
 * `not_configured` = chưa có địa chỉ máy chủ phát hành (nhà cung cấp cấu hình lúc bàn giao, khách không nhập được); `never_checked` = đã cấu hình nhưng chưa kiểm tra lần nào.
 */
export const softwareUpdateStatusSchema = z.object({
  state: updateCheckStateSchema,
  configured: z.boolean(),
  /** Chỉ để HIỂN THỊ (không sửa được trên giao diện). `null` khi chưa cấu hình. */
  releaseServerUrl: z.string().nullable(),
  channel: updateChannelSchema,
  currentVersion: z.string(),
  latest: releaseEntrySchema.nullable(),
  /** `true` khi phiên bản hiện tại thấp hơn `latest.minimumFromVersion` — phải qua bản trung gian trước. */
  needsIntermediateVersion: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  history: z.array(updateCheckHistoryItemSchema),
});
export type SoftwareUpdateStatus = z.infer<typeof softwareUpdateStatusSchema>;

/** Số bản trước tối đa hiện ở "Các bản trước" (mockup đã chốt 30/10/2026). */
export const RELEASE_NOTES_HISTORY_LIMIT = 10;

/**
 * `GET /system/update/release-notes` — ghi chú phát hành ĐÓNG KÈM phần mềm (không cần máy chủ phát hành): `current` = bản đang chạy (`null` nếu bản này không có ghi chú, ví dụ máy phát triển),
 * `previous` = các bản thấp hơn, mới nhất trước, tối đa `RELEASE_NOTES_HISTORY_LIMIT`.
 */
export const releaseNotesHistorySchema = z.object({
  current: releaseNotesSchema.nullable(),
  previous: z.array(releaseNotesSchema).max(RELEASE_NOTES_HISTORY_LIMIT),
});
export type ReleaseNotesHistory = z.infer<typeof releaseNotesHistorySchema>;

