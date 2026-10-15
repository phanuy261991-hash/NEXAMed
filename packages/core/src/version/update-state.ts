import type { ReleaseEntry, UpdateCheckState } from '@nexamed/shared';
import { compareSemver, isValidSemver } from './semver';

export interface UpdateCheckOutcome {
  /** `null` = chưa kiểm tra lần nào kể từ khi máy chủ khởi động. */
  result: { kind: 'ok'; latest: ReleaseEntry | null } | { kind: 'error'; message: string } | null;
}

export interface UpdateStateInput extends UpdateCheckOutcome {
  configured: boolean;
  currentVersion: string;
}

export interface UpdateStateResult {
  state: UpdateCheckState;
  latest: ReleaseEntry | null;
  needsIntermediateVersion: boolean;
  errorMessage: string | null;
}

/**
 * Suy trạng thái "Cập nhật phần mềm" từ kết quả lần kiểm tra gần nhất (docs/DECISIONS.md #236, bước 2). Hàm thuần, không đọc giờ hay mạng.
 * - Chưa cấu hình máy chủ phát hành → `not_configured`; đã cấu hình nhưng chưa kiểm → `never_checked`.
 * - Kênh chưa có bản nào, hoặc bản trên máy chủ KHÔNG mới hơn bản đang chạy → `up_to_date` (không bao giờ mời "hạ cấp").
 * - Phiên bản đang chạy không phải SemVer hợp lệ (ví dụ `0.0.0-dev` dự phòng vẫn hợp lệ, nhưng cấu hình sai thì không) → `error` rõ ràng thay vì so sánh sai.
 * - `needsIntermediateVersion`: bản mới có `minimumFromVersion` cao hơn bản đang chạy — phải qua bản trung gian trước.
 */
export function deriveUpdateState(input: UpdateStateInput): UpdateStateResult {
  const none = { latest: null, needsIntermediateVersion: false, errorMessage: null };
  if (!input.configured) return { state: 'not_configured', ...none };
  if (!input.result) return { state: 'never_checked', ...none };
  if (input.result.kind === 'error') return { state: 'error', ...none, errorMessage: input.result.message };

  const latest = input.result.latest;
  if (!latest) return { state: 'up_to_date', ...none };
  if (!isValidSemver(input.currentVersion)) {
    return { state: 'error', ...none, errorMessage: 'Không xác định được phiên bản đang chạy để so sánh.' };
  }
  if (compareSemver(latest.version, input.currentVersion) <= 0) return { state: 'up_to_date', ...none };
  const needsIntermediateVersion = latest.minimumFromVersion !== undefined && compareSemver(input.currentVersion, latest.minimumFromVersion) < 0;
  return { state: 'update_available', latest, needsIntermediateVersion, errorMessage: null };
}
