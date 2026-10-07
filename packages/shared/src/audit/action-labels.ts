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
  'invoice.partial_refunded': 'Hoàn tiền một phần (trả thuốc)',
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
  'user_account.self_updated': 'Tự sửa hồ sơ cá nhân',

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
  // 1 action DUY NHẤT cho cả đánh dấu thủ công lẫn tự động (job nền, #092/#093) — phân biệt qua
  // `noShowAutoMarked` trong dữ liệu, không phải action riêng. 2 khoá cũ ở đây (`marked_no_show`/
  // `auto_no_show`) chưa từng khớp action thật nào trong code — sửa lại đúng #109.
  'appointment.no_show': 'Đánh dấu không đến',

  // patient
  'patient.created': 'Tạo hồ sơ bệnh nhân',
  'patient.updated': 'Sửa hồ sơ bệnh nhân',
  'patient.photo_updated': 'Đổi ảnh đại diện',
  'patient.merged': 'Gộp hồ sơ trùng',
  'patient.viewed': 'Xem hồ sơ bệnh nhân',
  'patient.medical_record_exported': 'Xuất bệnh án PDF',
  'encounter.viewed': 'Xem hồ sơ khám',

  // drug
  'drug.created': 'Thêm thuốc',
  'drug.updated': 'Sửa thuốc',
  'drug.imported': 'Nhập thuốc & vật tư từ Excel',
  'drug.exported': 'Xuất thuốc & vật tư ra Excel',
  'print_template.created': 'Thêm bản mẫu in',
  'print_template.updated': 'Sửa bản mẫu in',
  'print_template.deleted': 'Xoá bản mẫu in',
  'print_template.quick_setup': 'Thiết lập nhanh mẫu in',
  'technical_service.created': 'Thêm dịch vụ kỹ thuật',
  'technical_service.updated': 'Sửa dịch vụ kỹ thuật',
  'lab_indicator.created': 'Thêm chỉ số xét nghiệm',
  'lab_indicator.updated': 'Sửa chỉ số xét nghiệm',
  'result_template.created': 'Thêm mẫu kết quả',
  'result_template.updated': 'Sửa mẫu kết quả',
  'service_package.created': 'Thêm gói dịch vụ',
  'service_package.updated': 'Sửa gói dịch vụ',
  'price_list.created': 'Tạo bảng giá',
  'price_list.updated': 'Sửa bảng giá',
  'price_list.stopped': 'Ngừng bảng giá',
  'price_list.resumed': 'Áp dụng lại bảng giá',
  'price_list.exported': 'Xuất bảng giá ra Excel',
  'clinical_order.saved': 'Lưu chỉ định cận lâm sàng',
  'clinical_order.printed': 'In phiếu chỉ định cận lâm sàng',
  'paraclinical.started': 'Lấy mẫu / gọi vào phòng thực hiện cận lâm sàng',
  'paraclinical_result.saved': 'Lưu nháp kết quả cận lâm sàng',
  'paraclinical_result.submitted': 'Gửi duyệt kết quả cận lâm sàng',
  'paraclinical_result.approved': 'Duyệt và trả kết quả cận lâm sàng',
  'paraclinical_result.viewed': 'Xem kết quả cận lâm sàng',

  // Bổ sung rà soát log (2026-10-07): các action dưới đây đã ghi audit từ trước nhưng thiếu nhãn tiếng Việt
  // (hiện nguyên văn dạng kỹ thuật ở màn Nhật ký). Test `audit-labels-coverage.spec.ts` chặn tái diễn.
  'clinical_order.viewed': 'Xem phiếu chỉ định cận lâm sàng',
  'stock_receipt.viewed': 'Xem phiếu nhập kho',
  'stock_receipt.created': 'Lập phiếu nhập kho',
  'stock_receipt.updated': 'Sửa phiếu nhập kho',
  'stock_receipt.approved': 'Duyệt phiếu nhập kho',
  'stock_receipt.rejected': 'Từ chối phiếu nhập kho',
  'stock_receipt.voided': 'Huỷ phiếu nhập kho',
  'stock_issue.viewed': 'Xem phiếu xuất kho',
  'stock_issue.created': 'Lập phiếu xuất kho',
  'stock_issue.updated': 'Sửa phiếu xuất kho',
  'stock_issue.approved': 'Duyệt phiếu xuất kho',
  'stock_issue.rejected': 'Từ chối phiếu xuất kho',
  'stock_issue.voided': 'Huỷ phiếu xuất kho',
  'stock_count.viewed': 'Xem phiếu kiểm kê',
  'stock_count.created': 'Lập phiếu kiểm kê',
  'stock_count.updated': 'Sửa phiếu kiểm kê',
  'stock_count.approved': 'Duyệt phiếu kiểm kê',
  'stock_count.rejected': 'Từ chối phiếu kiểm kê',
  'stock_transfer.viewed': 'Xem phiếu điều chuyển kho',
  'stock_transfer.created': 'Lập phiếu điều chuyển kho',
  'stock_transfer.updated': 'Sửa phiếu điều chuyển kho',
  'stock_transfer.shipped': 'Duyệt xuất điều chuyển kho',
  'stock_transfer.received': 'Xác nhận nhận hàng điều chuyển',
  'stock_transfer.rejected': 'Từ chối phiếu điều chuyển kho',
  'stock_ledger_report.exported': 'Xuất báo cáo Nhập-Xuất-Tồn ra Excel',
  'supplier.created': 'Thêm nhà cung cấp',
  'supplier.updated': 'Sửa nhà cung cấp',
  'warehouse.created': 'Thêm kho',
  'warehouse.updated': 'Sửa kho',
  'supplier_debt.purchase_recorded': 'Ghi công nợ phiếu nhập',
  'supplier_debt.return_recorded': 'Ghi giảm công nợ do trả hàng NCC',
  'supplier_debt.opening_balance_recorded': 'Khai nợ đầu kỳ nhà cung cấp',
  'supplier_debt.payment_reversed': 'Đảo bút toán thanh toán công nợ',
  'supplier_debt_adjustment.created': 'Lập phiếu điều chỉnh công nợ NCC',
  'supplier_debt_adjustment.approved': 'Duyệt phiếu điều chỉnh công nợ NCC',
  'supplier_debt_adjustment.rejected': 'Từ chối phiếu điều chỉnh công nợ NCC',
  'supplier_debt_reconciliation.created': 'Lập biên bản đối chiếu công nợ NCC',
  'supplier_debt_reconciliation.finalized': 'Chốt đối chiếu công nợ NCC',
  'supplier_debt_reconciliation.cancelled': 'Huỷ đối chiếu công nợ NCC',
  'cash_account.created': 'Thêm quỹ',
  'cash_account.updated': 'Sửa quỹ',
  'cash_voucher.viewed': 'Xem phiếu thu/chi',
  'cash_voucher.created': 'Lập phiếu thu/chi',
  'cash_voucher.updated': 'Sửa phiếu thu/chi',
  'cash_voucher.approved': 'Duyệt phiếu thu/chi',
  'cash_voucher.rejected': 'Từ chối phiếu thu/chi',
  'cash_voucher.voided': 'Huỷ phiếu thu/chi',
  'cash_voucher.printed': 'In phiếu thu/chi',
  'patient_wallet.topped_up': 'Nạp tiền ví tạm ứng',
  'patient_wallet.deducted': 'Trừ tiền ví tạm ứng',
  'patient_wallet.credited_back': 'Hoàn tiền vào ví tạm ứng',
  'patient_wallet.settled': 'Tất toán ví tạm ứng',
  'prescription_template.created': 'Thêm đơn thuốc mẫu',
  'prescription_template.updated': 'Sửa đơn thuốc mẫu',
  'business_code_template.updated': 'Sửa cấu hình mã hiển thị',
  'encounter.reassigned': 'Chuyển bác sĩ phụ trách lượt khám',
  'reception_list.exported': 'Xuất danh sách tiếp nhận ra Excel',
  'work_shift_assignment.exported': 'Xuất đăng ký ca làm việc ra Excel',

  // doctor-room-session / break-glass
  'doctor_room_session.set': 'Chọn phòng làm việc',
  'break_glass.request': 'Yêu cầu quyền khẩn cấp (break-glass)',
  'break_glass.access': 'Dùng quyền khẩn cấp (break-glass)',

  // work-shift / work-shift-assignment (#101/#102) — bổ sung #109, thiếu từ lúc thêm module
  'work_shift.created': 'Thêm ca làm việc',
  'work_shift.updated': 'Sửa ca làm việc',
  'work_shift_assignment.created': 'Đăng ký ca làm việc',
  'work_shift_assignment.bulk_created': 'Đăng ký ca hàng loạt',
  'work_shift_assignment.copied': 'Sao chép ca làm việc',
  'work_shift_assignment.deleted': 'Xoá ca làm việc',

  // doctor-availability (#094) — action tính động theo trạng thái, bổ sung #109
  'doctor_availability.ended': 'Đóng ca làm việc',
  'doctor_availability.break_started': 'Tạm nghỉ',
  'doctor_availability.resumed': 'Mở lại ca làm việc',

  // cashier-shift ("Chốt ca", 2026-09-03) — thêm nhãn NGAY lúc code, đúng bài học lặp lại
  // #087/#089/#104/#109 (thêm module mới mà quên vá bảng nhãn).
  'cashier_shift.opened': 'Mở ca',
  'cashier_shift.closed': 'Chốt ca',
  'cashier_shift.discrepancy_resolved': 'Xử lý chênh lệch phiếu chốt ca',
  'cashier_shift.approved': 'Duyệt phiếu chốt ca',
  'cashier_shift.edited': 'Sửa phiếu chốt ca đã khoá',
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
