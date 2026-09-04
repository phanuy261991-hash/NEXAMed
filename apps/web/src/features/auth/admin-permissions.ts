/**
 * Danh sách quyền dùng CHUNG giữa `Sidebar.tsx` (ẩn/hiện menu) và `router.tsx` (route guard) cho
 * nhóm "Quản trị" — đặt ở đây làm NGUỒN DUY NHẤT, tránh lặp 2 mảng ở 2 nơi rồi lệch nhau dần
 * (đúng bài học `workflow-roles.ts`, 2026-09-04).
 */

/** "Danh mục Tổ chức và Nhân sự" gộp 3 tính năng khác quyền (Vai trò & Phân quyền, Quản lý tài khoản, Khoa/Phòng, 4 pill nhân sự) — cần ÍT NHẤT MỘT. */
export const ADMIN_ORG_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['role_permission', 'manage'],
  ['user_account', 'manage'],
  ['reference_catalog', 'manage'],
];

/**
 * "Quản trị" nói chung — hiện khi actor có BẤT KỲ quyền quản trị nào. Cũng là fallback cho 2 mục
 * con KHÔNG có permission "manage" riêng: ICD-10 (`/admin/catalog-clinical`) tái dùng
 * `patient.read` ở backend (mọi vai trò lâm sàng đều có, gate riêng theo `.read` sẽ lộ menu này
 * cho bác sĩ/điều dưỡng/lễ tân — sai tinh thần "chỉ Quản trị"), và "Danh mục cận lâm sàng"
 * (`/admin/catalog-paraclinical`) còn là `ComingSoonPage`, chưa có permission route thật.
 */
export const ADMIN_ANY_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['reference_catalog', 'manage'],
  ['user_account', 'manage'],
  ['role_permission', 'manage'],
  ['drug', 'manage'],
  ['allergen_catalog', 'manage'],
  ['clinic_config', 'update'],
  ['audit_log', 'read'],
];
