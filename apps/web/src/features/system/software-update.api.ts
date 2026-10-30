import type { ReleaseNotesHistory, SoftwareUpdateStatus } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** "Cấu hình hệ thống → Cập nhật phần mềm" (docs/DECISIONS.md #236, bước 2) — quyền `software_update.read`; chỉ có ở hệ thống một công ty (SaaS trả 404). */
export async function getSoftwareUpdateStatus(): Promise<SoftwareUpdateStatus> {
  return unwrap(await getApiClient().GET('/api/v1/system/update/status')) as SoftwareUpdateStatus;
}

/** Ghi chú phát hành đóng kèm phần mềm: bản đang chạy + các bản trước (không cần máy chủ phát hành). */
export async function getReleaseNotesHistory(): Promise<ReleaseNotesHistory> {
  return unwrap(await getApiClient().GET('/api/v1/system/update/release-notes')) as ReleaseNotesHistory;
}

/** "Kiểm tra ngay": hỏi máy chủ phát hành, ghi nhật ký, trả trạng thái mới. */
export async function checkSoftwareUpdate(): Promise<SoftwareUpdateStatus> {
  return unwrap(await getApiClient().POST('/api/v1/system/update/check')) as SoftwareUpdateStatus;
}
