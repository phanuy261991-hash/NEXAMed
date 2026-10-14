import { BranchNotSelectedError, type BranchDirectoryPort } from '@nexamed/core';

/**
 * Chi nhánh đang làm việc của phiên (docs/DECISIONS.md #231) — mọi service dữ liệu theo địa điểm (lượt khám, lịch hẹn, phòng...) nhận giá trị này
 * từ controller và lọc/gắn `branch_id` theo đó. Phiên chưa chọn chi nhánh (được gán nhiều chi nhánh mà chưa chọn) → 409 `BRANCH_NOT_SELECTED`,
 * web hiện màn "Chọn chi nhánh làm việc".
 */
export function requireBranchId(user: { branchId: string | null }): string {
  if (!user.branchId) {
    throw new BranchNotSelectedError();
  }
  return user.branchId;
}

/**
 * Danh sách chi nhánh một màn danh sách/báo cáo được phép đọc (Đợt 2 chi nhánh, docs/DECISIONS.md #233): mặc định CHỈ chi nhánh đang làm việc;
 * `allBranches` = mọi chi nhánh tài khoản được gán (luôn có chi nhánh đang làm). Kết quả dùng làm `branch_id IN (...)` ở repository — cách ly theo
 * chi nhánh luôn là điều kiện lọc, không phải cờ bật/tắt. Port tự mở transaction riêng nên gọi TRƯỚC transaction chính của caller.
 */
export async function resolveBranchScope(
  branchDirectory: BranchDirectoryPort,
  tenantId: string,
  userId: string,
  currentBranchId: string,
  allBranches: boolean,
): Promise<string[]> {
  if (!allBranches) return [currentBranchId];
  const assigned = await branchDirectory.listAssignedBranchIds(tenantId, userId);
  return assigned.includes(currentBranchId) ? assigned : [currentBranchId, ...assigned];
}
