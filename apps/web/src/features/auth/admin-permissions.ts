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

/** "Tra cứu kết quả" (docs/DECISIONS.md #232) — có quyền xem kết quả của ÍT NHẤT MỘT nhóm (Xét nghiệm hoặc CĐHA & Thăm dò chức năng). Route guard (`router.tsx`) và menu (`Sidebar.tsx`) dùng chung. */
export const PARACLINICAL_LOOKUP_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['lab_result', 'read'],
  ['imaging_result', 'read'],
];

/** "Danh mục Cận lâm sàng" (docs/DECISIONS.md #212) — thêm/sửa dịch vụ kỹ thuật + chỉ số xét nghiệm (`technical_service`), hoặc quản lý mẫu
 * kết quả (`result_template.manage`, bác sĩ cũng có). Dùng chung cho route guard (`router.tsx`) và ẩn/hiện menu (`Sidebar.tsx`). */
export const PARACLINICAL_CATALOG_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['technical_service', 'create'],
  ['technical_service', 'update'],
  ['result_template', 'manage'],
  // Cận lâm sàng GĐ2 — pill "Gói dịch vụ" nằm cùng trang này (quyền riêng `service_package`).
  ['service_package', 'create'],
  ['service_package', 'update'],
];

/** "Bảng giá" (`/admin/price-lists`, Cận lâm sàng GĐ2, docs/DECISIONS.md #212) — tạo/sửa/ngừng bảng giá có thời hạn. `price_list.read` KHÔNG đủ để hiện menu
 * (lễ tân/bác sĩ có quyền đọc để tra giá nhưng không quản trị bảng giá). Dùng chung cho route guard và ẩn/hiện menu. */
export const PRICE_LIST_ADMIN_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['price_list', 'create'],
  ['price_list', 'update'],
];

/** "Cấu hình hệ thống" (`/admin/system-config`) — `clinic_config.update` cho các pill cấu hình phòng khám, hoặc `system_backup.read` cho pill "Sao lưu dữ liệu"
 * (docs/DECISIONS.md #217: vai trò `system_admin` chỉ có quyền sao lưu, không có `clinic_config.*` — vẫn phải vào được trang để dùng pill của mình).
 * Dùng chung cho route guard (`router.tsx`) và ẩn/hiện menu (`Sidebar.tsx`). */
export const SYSTEM_CONFIG_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['clinic_config', 'update'],
  ['system_backup', 'read'],
];

/**
 * "Quản trị" nói chung — hiện khi actor có BẤT KỲ quyền quản trị nào. Cũng là fallback cho 2 mục
 * con KHÔNG có permission "manage" riêng: ICD-10 (`/admin/catalog-clinical`) tái dùng
 * `patient.read` ở backend (mọi vai trò lâm sàng đều có, gate riêng theo `.read` sẽ lộ menu này
 * cho bác sĩ/điều dưỡng/lễ tân — sai tinh thần "chỉ Quản trị"). "Danh mục Cận lâm sàng" đã có permission riêng
 * (`PARACLINICAL_CATALOG_PERMISSIONS`, #212) nên gộp vào đây để người chỉ được quản lý mẫu kết quả vẫn thấy nhóm Quản trị.
 */
export const ADMIN_ANY_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['reference_catalog', 'manage'],
  ['user_account', 'manage'],
  ['role_permission', 'manage'],
  ['drug', 'create'],
  ['drug', 'update'],
  ['allergen_catalog', 'manage'],
  ['clinic_config', 'update'],
  ['audit_log', 'read'],
  ['technical_service', 'create'],
  ['technical_service', 'update'],
  ['result_template', 'manage'],
  ['service_package', 'create'],
  ['service_package', 'update'],
  ['price_list', 'create'],
  ['price_list', 'update'],
];

/**
 * "Danh mục Chuyên môn" (`/admin/catalog-clinical`): quyền của API mỗi pill gọi (ICD-10 dùng `patient.read`, Từ viết tắt/Dịch vụ khám dùng `reference_catalog.read`, Dị nguyên
 * `allergen_catalog.read`, Mẫu lời dặn `advice_template.read`). Cần ÍT NHẤT MỘT thì trang mới có pill để hiện — vai trò `system_admin` (chỉ quản lý tài khoản/sao lưu) không có cái nào,
 * nên mục menu ẩn và route chặn thay vì mở ra một trang chỉ toàn lỗi 403. Phải khớp các pill ở `CatalogClinicalPage.tsx`; đi cùng `ADMIN_ANY_PERMISSIONS` (nhóm "Quản trị") — cả hai điều kiện đều phải đúng.
 */
export const CLINICAL_CATALOG_PILL_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['patient', 'read'],
  ['reference_catalog', 'read'],
  ['allergen_catalog', 'read'],
  ['advice_template', 'read'],
];

/** "Danh mục Thuốc và Vật Tư"/"Quản lý nhà cung cấp"/"Kho" — trước gộp `drug.manage`, tách thành
 * `create`/`update` (docs/DECISIONS.md #156). Dùng chung cho route guard (`router.tsx`) và ẩn/hiện
 * menu (`Sidebar.tsx`), tránh lặp mảng ở 2 nơi như comment đầu file đã nêu. */
export const DRUG_MANAGE_PERMISSIONS: ReadonlyArray<readonly [string, string]> = [
  ['drug', 'create'],
  ['drug', 'update'],
];
