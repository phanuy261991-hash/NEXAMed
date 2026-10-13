import { BranchNotSelectedError } from '@nexamed/core';

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
