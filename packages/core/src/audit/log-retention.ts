/**
 * Chính sách lưu trữ `audit_log` (chủ dự án chốt trực tiếp, chờ Q1/`docs/product/prd.md` xác nhận
 * pháp lý cho phần "Log nghiệp vụ" — 2 tầng theo Thông tư 46/2018/TT-BYT):
 *
 * - **Log nghiệp vụ** (gắn trực tiếp với hồ sơ bệnh án/khách hàng — patient, encounter, appointment,
 *   invoice, vital_sign, và mọi `entityType` khác KHÔNG có trong danh sách dưới đây, kể cả
 *   entityType chưa biết trong tương lai): giữ VĨNH VIỄN, không bao giờ tự động xoá — mặc định AN
 *   TOÀN (default-keep), tránh xoá nhầm log lâm sàng nếu quên cập nhật danh sách khi thêm domain
 *   mới.
 * - **System Log / Technical Log** (thuần vận hành hệ thống, không phải hồ sơ bệnh án — tài khoản,
 *   vai trò, danh mục dùng chung, cấu hình phòng khám...): chỉ giữ `SYSTEM_LOG_RETENTION_DAYS`
 *   ngày, xoá sau đó qua job nền (`AuditLogRepository.purgeSystemLogsOlderThan()`).
 *
 * `break_glass.request`/`break_glass.access` KHÔNG cần liệt kê riêng — `entityType` của 2 action
 * này luôn là entity lâm sàng đang được truy cập vượt quyền (`patient`/`encounter`...), tự động rơi
 * vào nhóm "Log nghiệp vụ" giữ vĩnh viễn vì không có trong `SYSTEM_LOG_ENTITY_TYPES`.
 */
export const SYSTEM_LOG_RETENTION_DAYS = 90;

const SYSTEM_LOG_ENTITY_TYPES = new Set([
  'user_account',
  'role',
  'reference_catalog',
  'allergen',
  'allergen_group',
  'department',
  'department_type',
  'room',
  'floor',
  'exam_station',
  'drug',
  'doctor_room_session',
  'doctor_availability',
  'tenant',
]);

export function isSystemLogEntityType(entityType: string): boolean {
  return SYSTEM_LOG_ENTITY_TYPES.has(entityType);
}

export function systemLogEntityTypes(): string[] {
  return [...SYSTEM_LOG_ENTITY_TYPES];
}
