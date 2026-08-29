/**
 * Nhãn tiếng Việt cho `audit_log.action` — "Nhật ký hoạt động" (S5-05, ADM-03). Hàm thuần, dùng
 * chung cả `apps/api` (dựng `actionLabel` trong response) lẫn `apps/web` (không có sẵn nếu chỉ đặt
 * ở `packages/core` — ESLint chặn `apps/web` import `@nexamed/core`, xem `.claude/docs/
 * coding-standards.md` mục "Hiệu suất"). Action lạ (chưa map) fallback trả về nguyên văn thay vì
 * throw, vì đây là màn hình hiển thị chứ không phải validate dữ liệu.
 *
 * Danh sách khảo sát từ toàn bộ lời gọi `writeAuditLog(...)` trong `apps/api/src` tính tới S5-05 —
 * action mới thêm sau này CHỈ cần bổ sung 1 dòng ở đây, không đổi gì khác.
 */
const ACTION_LABELS: Record<string, string> = {
  // encounter (apps/api/src/modules/encounter/encounter.service.ts)
  'encounter.consultation_started': 'Bắt đầu khám',
  'encounter.cancelled': 'Huỷ lượt khám',
  'encounter.released': 'Trả về hàng chờ',
  'encounter.diagnosis_saved': 'Lưu chẩn đoán',
  'encounter.clinical_note_saved': 'Lưu ghi chú khám',
  'encounter.completed': 'Hoàn tất khám',
  'encounter.registered_direct': 'Tiếp nhận trực tiếp',
  'encounter.checked_in': 'Check-in',
  'diagnosis.amended': 'Đính chính chẩn đoán',
  'clinical_note.amended': 'Đính chính ghi chú khám',
  'prescription.items_saved': 'Lưu đơn thuốc',
  'prescription.signed': 'Ký đơn thuốc',
  'prescription.signed_with_warnings': 'Ký đơn thuốc (có cảnh báo)',
  'prescription.printed': 'In đơn thuốc',
  'prescription.amended': 'Đính chính đơn thuốc',

  // clinic (clinic-settings.service.ts, clinic-profile.service.ts)
  'clinic_settings.updated': 'Sửa cấu hình phòng khám',
  'clinic_profile.updated': 'Sửa thông tin phòng khám',
  'clinic_profile.logo_updated': 'Đổi logo phòng khám',
  'clinic_profile.print_logo_updated': 'Đổi logo bản in',

  // billing (invoice.service.ts, reception.service.ts)
  'invoice.created': 'Tạo phiếu thu',
  'invoice.paid': 'Đánh dấu đã thu',
  'invoice.payment_reverted': 'Đánh dấu chưa thu',
  'invoice.refunded': 'Hoàn tiền',
  'invoice.draft_saved': 'Lưu nháp phiếu thu',
  'invoice.printed': 'In phiếu thu',
  'invoice.cancelled': 'Huỷ phiếu thu',

  // reception (reception.service.ts)
  'vital_sign.created': 'Nhập sinh hiệu',
  'appointment.checked_in': 'Check-in từ lịch hẹn',

  // auth (auth.service.ts)
  'auth.login_success': 'Đăng nhập thành công',
  'auth.login_failed': 'Đăng nhập thất bại',
  'auth.refresh_reuse_detected': 'Phát hiện dùng lại refresh token (thu hồi phiên)',
  'auth.logout': 'Đăng xuất',
  'auth.password_changed': 'Đổi mật khẩu',

  // user-account (user-account.service.ts)
  'user_account.created': 'Tạo tài khoản',
  'user_account.updated': 'Sửa tài khoản',
  'user_account.role_changed': 'Đổi vai trò',
  'user_account.password_reset': 'Đặt lại mật khẩu',
  'user_account.signature_updated': 'Cập nhật chữ ký',

  // reference-catalog / allergen / allergen-group
  'reference_catalog.created': 'Thêm danh mục',
  'reference_catalog.updated': 'Sửa danh mục',
  'reference_catalog.reactivated': 'Kích hoạt lại danh mục',
  'reference_catalog.deactivated': 'Ẩn danh mục',
  'allergen.created': 'Thêm dị nguyên',
  'allergen.updated': 'Sửa dị nguyên',
  'allergen.reactivated': 'Kích hoạt lại dị nguyên',
  'allergen.deactivated': 'Ẩn dị nguyên',
  'allergen_group.created': 'Thêm nhóm dị nguyên',
  'allergen_group.updated': 'Sửa nhóm dị nguyên',
  'allergen_group.reactivated': 'Kích hoạt lại nhóm dị nguyên',
  'allergen_group.deactivated': 'Ẩn nhóm dị nguyên',

  // department / department-type
  'department.created': 'Thêm Khoa/Phòng',
  'department.updated': 'Sửa Khoa/Phòng',
  'department_type.created': 'Thêm loại Khoa/Phòng',
  'department_type.updated': 'Sửa loại Khoa/Phòng',

  // role
  'role.created': 'Tạo vai trò',
  'role.renamed': 'Đổi tên vai trò',
  'role.hidden': 'Ẩn vai trò',
  'role_permission.updated': 'Sửa ma trận phân quyền',

  // room / floor / exam-station
  'room.created': 'Thêm phòng',
  'room.updated': 'Sửa phòng',
  'floor.created': 'Thêm tầng',
  'floor.updated': 'Sửa tầng',
  'exam_station.created': 'Thêm bàn khám',
  'exam_station.updated': 'Sửa bàn khám',

  // appointment
  'appointment.created': 'Đặt lịch hẹn',
  'appointment.cancelled': 'Huỷ lịch hẹn',
  'appointment.updated': 'Sửa lịch hẹn',
  'appointment.rescheduled': 'Dời lịch hẹn',
  'appointment.marked_no_show': 'Đánh dấu không đến',
  'appointment.auto_no_show': 'Tự động đánh dấu không đến',

  // patient
  'patient.created': 'Tạo hồ sơ bệnh nhân',
  'patient.updated': 'Sửa hồ sơ bệnh nhân',
  'patient.photo_updated': 'Đổi ảnh đại diện',
  'patient.merged': 'Gộp hồ sơ trùng',
  'patient.viewed': 'Xem hồ sơ bệnh nhân',
  'encounter.viewed': 'Xem hồ sơ khám',

  // drug
  'drug.created': 'Thêm thuốc',
  'drug.updated': 'Sửa thuốc',

  // doctor-room-session / break-glass
  'doctor_room_session.set': 'Chọn phòng làm việc',
  'break_glass.request': 'Yêu cầu quyền khẩn cấp (break-glass)',
  'break_glass.access': 'Dùng quyền khẩn cấp (break-glass)',
};

export function labelForAuditAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * Thao tác "phá kính" (break-glass, `.claude/docs/security-audit.md`) — luôn vượt qua kiểm tra
 * quyền `data_scope` thông thường, cần cảnh báo nổi bật riêng khi rà soát "Nhật ký hoạt động"
 * (S5-05, chủ dự án yêu cầu trực tiếp) thay vì lẫn vào các dòng hoạt động bình thường khác.
 */
export function isBreakGlassAction(action: string): boolean {
  return action === 'break_glass.request' || action === 'break_glass.access';
}
