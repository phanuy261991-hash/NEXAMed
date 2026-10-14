import { useAuthStore } from '../auth/auth.store';
import { showBranchInfo } from './branch-visibility';

/**
 * Dùng chung (Đợt 2 chi nhánh, docs/DECISIONS.md #233): chứng từ/dòng dữ liệu có thuộc chi nhánh KHÁC chi nhánh đang làm việc không. Công ty 1 chi nhánh luôn trả `false`
 * (không có khái niệm "chi nhánh khác" trên giao diện). Dùng để khoá nút mở phiếu của chi nhánh khác (máy chủ trả 404) thay vì để người dùng
 * bấm rồi gặp trang lỗi.
 */
export function useIsOtherBranch(branchId: string | null | undefined): boolean {
  const currentBranchId = useAuthStore((s) => s.user?.currentBranchId ?? null);
  // Không cần điều kiện "nhiều chi nhánh": công ty 1 chi nhánh thì mọi chứng từ luôn cùng chi nhánh hiện hành nên tự trả false.
  if (!branchId || !currentBranchId) return false;
  return branchId !== currentBranchId;
}

/** Hiện chi nhánh chỉ khi tài khoản làm việc ở từ 2 chi nhánh (công ty 1 chi nhánh: không hiện gì). */
export function useShowBranchInfo(): boolean {
  return showBranchInfo(useAuthStore((s) => s.user));
}

/**
 * Nhãn tên chi nhánh gọn: tên dài bị cắt có tooltip (tên chi nhánh tối đa 100 ký tự nhưng vẫn có thể dài hơn ô). `otherBranch` = chi nhánh KHÁC đang làm việc → tông
 * hổ phách báo "không mở được phiếu ở đây".
 */
export function BranchChip({ name, otherBranch = false, className = '' }: { name: string | null | undefined; otherBranch?: boolean; className?: string }) {
  if (!name) return null;
  const tone = otherBranch ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-teal-600 bg-teal-50 text-teal-700';
  return (
    <span
      className={`inline-block max-w-[180px] truncate rounded border px-2 py-0.5 align-middle text-xs font-semibold ${tone} ${className}`}
      title={otherBranch ? `${name} — chứng từ của chi nhánh khác, đổi chi nhánh để mở` : name}
    >
      {name}
    </span>
  );
}
