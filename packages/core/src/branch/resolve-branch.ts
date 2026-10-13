/**
 * Chọn chi nhánh làm việc của phiên (docs/DECISIONS.md #231) — logic thuần, không phụ thuộc framework.
 *
 * - Không được gán chi nhánh nào → `null` (tài khoản chưa dùng được dữ liệu theo địa điểm).
 * - Đúng 1 chi nhánh → chọn luôn (phòng khám 1 chi nhánh không bao giờ phải chọn).
 * - Từ 2 chi nhánh: dùng chi nhánh phiên đang có / chi nhánh nhớ lần trước nếu còn được phép, không thì `null` (web hiện màn "Chọn chi nhánh").
 */
export function resolveBranchId(
  assignedBranchIds: readonly string[],
  candidates: { sessionBranchId?: string | null; lastBranchId?: string | null },
): string | null {
  if (assignedBranchIds.length === 0) return null;
  if (assignedBranchIds.length === 1) return assignedBranchIds[0] ?? null;
  for (const candidate of [candidates.sessionBranchId, candidates.lastBranchId]) {
    if (candidate && assignedBranchIds.includes(candidate)) return candidate;
  }
  return null;
}
