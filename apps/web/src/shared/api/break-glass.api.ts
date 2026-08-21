import type { BreakGlassRequest, BreakGlassResponse } from '@nexamed/shared';
import { getApiClient, unwrap } from './client';

/**
 * Xin phá kính (break-glass) — `POST /api/v1/break-glass` (`.claude/docs/security-audit.md` mục
 * Break-glass). Đặt ở `shared/api` (không phải một feature cụ thể) vì đây là cơ chế vượt quyền
 * dùng chung cho MỌI màn hình chạm dữ liệu có `data_scope` (`entityType` khớp `module` của
 * `@RequirePermission` đang bị chặn — ví dụ `'diagnosis'`/`'clinical_note'`/`'patient'`), viết với
 * chủ đích tái dùng ngay lần đầu theo CLAUDE.md. Lần dùng thật đầu tiên: màn hình khám sửa hồ sơ sau
 * khi "Hoàn tất khám" (`EncounterConsultationPage.tsx`).
 */
export async function requestBreakGlass(body: BreakGlassRequest): Promise<BreakGlassResponse> {
  return unwrap(await getApiClient().POST('/api/v1/break-glass', { body })) as BreakGlassResponse;
}