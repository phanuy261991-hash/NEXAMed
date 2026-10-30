import { compareSemver, isValidSemver } from './semver';

/**
 * "Các bản trước" ở trang Cập nhật phần mềm (mockup đã chốt https://claude.ai/artifact/R6oTbDuS7fczynmib7V5BT, 30/10/2026): từ MỌI ghi chú phát hành đóng kèm phần mềm, lấy các bản
 * THẤP HƠN bản đang chạy, mới nhất trước, tối đa `limit` bản. Bản không đúng SemVer, bản trùng số phiên bản (lấy bản đầu), bản bằng hoặc cao hơn bản đang chạy đều bị bỏ.
 * Hàm thuần (không đọc file) — nơi gọi tự đọc và kiểm định dạng từng ghi chú.
 */
export function selectReleaseNotesHistory<T extends { version: string }>(allNotes: readonly T[], currentVersion: string, limit: number): T[] {
  if (!isValidSemver(currentVersion) || limit <= 0) return [];
  const seen = new Set<string>();
  const older: T[] = [];
  for (const note of allNotes) {
    if (!isValidSemver(note.version) || seen.has(note.version)) continue;
    if (compareSemver(note.version, currentVersion) >= 0) continue;
    seen.add(note.version);
    older.push(note);
  }
  return older.sort((a, b) => compareSemver(b.version, a.version)).slice(0, limit);
}
