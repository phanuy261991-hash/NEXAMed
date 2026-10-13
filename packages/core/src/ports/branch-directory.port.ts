/**
 * Tra cứu chi nhánh cho module KHÁC (docs/DECISIONS.md #231) — module không import trực tiếp module `iam` (nơi sở hữu bảng `branch`/`user_branch`),
 * đọc qua port này. Tự mở transaction riêng (port chỉ nhận `tenantId`, cùng khuôn `DoctorDirectoryPort`).
 */
export interface BranchDirectoryPort {
  /** `id → tên` cho MỌI chi nhánh còn tồn tại (kể cả đã ngưng — lịch sử khám cũ vẫn phải hiện đúng nơi khám). */
  getBranchNames(tenantId: string): Promise<Map<string, string>>;
  /**
   * Chi nhánh tài khoản được làm việc (chỉ chi nhánh còn hoạt động). Quy tắc cùng `BranchAccessService`: công ty ≤ 1 chi nhánh hoạt động thì
   * mọi tài khoản thuộc chi nhánh đó. Dùng để quyết định hiện/ẩn số tiền của lượt khám ở chi nhánh khác.
   */
  listAssignedBranchIds(tenantId: string, userId: string): Promise<string[]>;
  /** Công ty có từ 2 chi nhánh hoạt động trở lên không — giao diện chỉ hiện cột/nhãn chi nhánh khi `true`. */
  isMultiBranch(tenantId: string): Promise<boolean>;
}

export const BRANCH_DIRECTORY_PORT = Symbol('BRANCH_DIRECTORY_PORT');
