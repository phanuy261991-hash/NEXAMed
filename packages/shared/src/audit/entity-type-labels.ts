/**
 * Nhãn tiếng Việt cho `audit_log.entityType` — dùng khi KHÔNG resolve được tên cụ thể của bản ghi
 * (chỉ `patient`/`encounter` mới resolve tên thật, xem `AuditLogService`). Trước đây fallback hiện
 * `${entityType} · ${entityId.slice(0,8)}` (kỹ thuật, lộ UUID thô) — chủ dự án phản hồi không nên
 * hiện dạng này, đổi sang thuần nhãn tiếng Việt, bỏ hẳn UUID (thời gian ở cột riêng đã đủ phân biệt
 * các dòng cùng loại). entityType lạ (chưa map) fallback trả về nguyên văn, cùng tinh thần
 * `labelForAuditAction`. Đặt ở `packages/shared` (không phải `packages/core`) vì `apps/web` cũng
 * cần dùng để hiển thị.
 */
const ENTITY_TYPE_LABELS: Record<string, string> = {
  patient: 'Bệnh nhân',
  encounter: 'Lượt khám',
  invoice: 'Phiếu thu',
  tenant: 'Phòng khám',
  vital_sign: 'Sinh hiệu',
  user_account: 'Tài khoản người dùng',
  role: 'Vai trò',
  reference_catalog: 'Danh mục dùng chung',
  allergen: 'Dị nguyên',
  allergen_group: 'Nhóm dị nguyên',
  department: 'Khoa/Phòng',
  department_type: 'Loại Khoa/Phòng',
  room: 'Phòng',
  floor: 'Tầng',
  exam_station: 'Bàn khám',
  appointment: 'Lịch hẹn',
  drug: 'Thuốc',
  doctor_room_session: 'Phòng làm việc',
  break_glass_session: 'Quyền khẩn cấp (break-glass)',
};

export function labelForEntityType(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}
