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
  /**
   * Tên/địa chỉ/SĐT của MỘT chi nhánh (kể cả đã ngưng) — dùng cho ĐẦU PHIẾU IN theo chi nhánh của chứng từ (Đợt 2, docs/DECISIONS.md #233). `null` nếu
   * không có chi nhánh đó trong công ty.
   */
  getBranchPrintInfo(tenantId: string, branchId: string): Promise<{ name: string; address: string | null; phone: string | null } | null>;
  /**
   * Mã cơ sở khám chữa bệnh (5 chữ số) riêng của MỘT chi nhánh (docs/DECISIONS.md #242) — `null` nếu không có chi nhánh đó hoặc chi nhánh chưa nhập
   * (nơi gọi tự quay về mã công ty). Dùng để ghép mã đơn thuốc chuẩn Bộ Y tế.
   */
  getBranchFacilityCode(tenantId: string, branchId: string): Promise<string | null>;
  /** Mọi chi nhánh đang hoạt động kèm mã KCB riêng (có thể null) — thứ tự: mặc định đứng đầu rồi theo tên. Dùng kiểm tra "sẵn sàng bật chế độ chuẩn". */
  listActiveBranchFacilityInfo(tenantId: string): Promise<{ id: string; name: string; isDefault: boolean; facilityCode: string | null }[]>;
}

export const BRANCH_DIRECTORY_PORT = Symbol('BRANCH_DIRECTORY_PORT');
