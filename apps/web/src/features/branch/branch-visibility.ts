import type { BranchLite, CurrentUser } from '@nexamed/shared';

/**
 * Quy tắc hiện/ẩn giao diện chi nhánh (docs/DECISIONS.md #231, mockup đã duyệt): công ty/tài khoản chỉ có MỘT chi nhánh thì mọi thứ liên quan chi nhánh
 * (màn chọn, bộ chuyển, ô gán, cột "Chi nhánh") ẩn hoàn toàn — giao diện không đổi gì. Tách thành hàm thuần để test được, dùng chung RequireAuth/TopBar.
 */
type BranchUser = (Pick<CurrentUser, 'branches' | 'currentBranchId'> & Partial<Pick<CurrentUser, 'multiBranchCompany'>>) | null | undefined;

/** Tài khoản được làm việc ở từ 2 chi nhánh trở lên → mới có giao diện chọn/chuyển chi nhánh. */
export function hasMultipleBranches(user: BranchUser): boolean {
  return (user?.branches.length ?? 0) > 1;
}

/**
 * Hiện nhãn/cột/tab chi nhánh trên chứng từ: tài khoản được gán nhiều chi nhánh HOẶC công ty có nhiều chi nhánh (kể cả nhân viên chỉ thuộc một chi nhánh vẫn phải thấy
 * phiếu đang đến từ chi nhánh khác — Đợt 2, docs/DECISIONS.md #233). Công ty 1 chi nhánh: `false` → giao diện không đổi. KHÁC `hasMultipleBranches` (chỉ dành cho bộ chuyển/chọn chi nhánh).
 */
export function showBranchInfo(user: BranchUser): boolean {
  return hasMultipleBranches(user) || user?.multiBranchCompany === true;
}

/** Được gán nhiều chi nhánh mà phiên chưa chọn nơi làm việc → phải qua màn "Chọn chi nhánh làm việc" trước. */
export function needsBranchSelection(user: BranchUser): boolean {
  return hasMultipleBranches(user) && user?.currentBranchId == null;
}

export function findCurrentBranch(user: BranchUser): BranchLite | null {
  if (!user || user.currentBranchId == null) return null;
  return user.branches.find((b) => b.id === user.currentBranchId) ?? null;
}
