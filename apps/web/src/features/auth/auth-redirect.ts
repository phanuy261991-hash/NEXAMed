import type { CurrentUser } from '@nexamed/shared';
import { needsBranchSelection } from '../branch/branch-visibility';

export const CHANGE_PASSWORD_PATH = '/change-password';
export const CHOOSE_BRANCH_PATH = '/choose-branch';

/**
 * Route guard của `RequireAuth` tách thành hàm thuần để test được: trả đường dẫn cần chuyển hướng tới, hoặc `null` nếu được vào.
 * Thứ tự: chưa đăng nhập → /login; buộc đổi mật khẩu → /change-password; được gán từ 2 chi nhánh mà phiên chưa chọn → /choose-branch
 * (docs/DECISIONS.md #231 — đổi mật khẩu xong mới chọn chi nhánh). `status==='idle'` (đang khôi phục phiên) do `RequireAuth` tự xử lý trước.
 */
export function getAuthRedirect(
  user: Pick<CurrentUser, 'mustChangePassword' | 'branches' | 'currentBranchId'> | null,
  pathname: string,
): string | null {
  if (user?.mustChangePassword === true && pathname !== CHANGE_PASSWORD_PATH) return CHANGE_PASSWORD_PATH;
  if (user?.mustChangePassword !== true && needsBranchSelection(user) && pathname !== CHOOSE_BRANCH_PATH) return CHOOSE_BRANCH_PATH;
  return null;
}
