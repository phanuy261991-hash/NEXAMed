/**
 * Quyền ĐI KÈM — gợi ý ở màn "Vai trò & Phân quyền" (docs/DECISIONS.md #208). Mỗi trang web gọi thêm API của
 * module khác để dựng ô chọn/bảng (danh mục, kho, quỹ, tài khoản...); vai trò tuỳ biến chỉ tick quyền của route
 * thì trang vẫn MỞ ĐƯỢC nhưng các ô đó bị 403. Bảng này liệt kê, cho từng quyền, các quyền ĐỌC mà trang của nó cần.
 *
 * Chỉ là GỢI Ý hiển thị — KHÔNG chặn lưu, KHÔNG tự cấp, KHÔNG dùng trong `PermissionGuard`. Dữ liệu lấy từ quét
 * thật bằng Chrome (mỗi trang, chỉ cấp đúng quyền của route, ghi lại API bị 403 → đối chiếu `@RequirePermission`
 * của endpoint), không đoán tay. Chỉ gồm quyền khi MỞ TRANG; thao tác phát sinh sau (dialog, nút) không nằm ở đây.
 * Thêm trang/endpoint mới thì cập nhật bảng này (test `permission-companions.spec.ts` chỉ kiểm tính hợp lệ).
 */
export const PERMISSION_COMPANIONS: Readonly<Record<string, readonly string[]>> = {
  'patient.create': ['patient.read', 'allergen_catalog.read', 'reference_catalog.read'],
  'encounter.read': ['appointment.read', 'reference_catalog.read'],
  // Quét vai trò tuỳ biến 27/10/2026: màn khám cần danh mục loại tiếp nhận; chỉ định cận lâm sàng cần danh sách bác sĩ (`GET /appointments/doctors` gắn `appointment.read`).
  'encounter.read_clinical': ['reference_catalog.read'],
  'clinical_order.read': ['appointment.read'],
  'encounter.create': ['encounter.read', 'patient.read', 'appointment.read', 'allergen_catalog.read', 'reference_catalog.read'],
  'invoice.read': ['cashier_shift.read', 'reference_catalog.read'],
  'cashier_shift.read': ['user_account.read'],
  // Hộp thêm/sửa tài khoản cần danh sách vai trò + danh mục nhân sự (#260).
  'user_account.manage': ['user_account.read', 'role_permission.read', 'reference_catalog.read'],
  'role_permission.manage': ['role_permission.read'],
  'cash_voucher.read': ['cash_account.read', 'reference_catalog.read'],
  // Phiếu nhập kho chọn nhà cung cấp (#291: quyền nhà cung cấp đã tách khỏi `drug.*`); trang Công nợ NCC cũng đọc danh sách nhà cung cấp.
  'stock_receipt.read': ['drug.read', 'supplier.read', 'cash_account.read', 'reference_catalog.read'],
  'stock_receipt.create': ['drug.read', 'supplier.read', 'cash_account.read', 'reference_catalog.read'],
  'supplier_debt.read': ['supplier.read'],
  // Quyền thêm 28/10–06/11/2026 (#279–#291). Báo cáo: quét vai trò tuỳ biến 06/11/2026 (`role-access-sweep.cjs`, phần custom) — hai trang còn gọi API của module khác khi mở: báo cáo Bác sĩ lọc theo Khoa
  // (`GET /departments/options` cần `reference_catalog.read`), báo cáo Khám bệnh và vận hành lọc theo bác sĩ (`GET /appointments/doctors` cần `appointment.read`); các báo cáo còn lại và "Hẹn tái khám" mở trọn.
  'doctor_report.read': ['reference_catalog.read'],
  'operations_report.read': ['appointment.read'],
  // Tổng quan thu ngân đọc ca đang mở (mở/chốt ca ngay trên trang). Tổng quan bác sĩ còn đọc trạng thái đóng ca (cần quyền GHI `doctor_availability.update`, không đưa vào đây vì bảng này chỉ gợi ý quyền ĐỌC) nên trang chỉ gọi khi có quyền đó.
  'dashboard.cashier': ['cashier_shift.read'],
  // "Hẹn tái khám": ghi lần nhắc cần xem danh sách. "Khách không làm dịch vụ" là nút trên phiếu thu nên cần xem được phiếu.
  'follow_up.remind': ['follow_up.read'],
  'invoice.cancel_service': ['invoice.read'],
  // Nhà cung cấp & đối tác xét nghiệm (#291): sửa/thêm cần xem danh sách.
  'supplier.create': ['supplier.read'],
  'supplier.update': ['supplier.read'],
  // Hàng đợi "Gửi mẫu đối tác" (#291): nút Gửi/Nhận chỉ có ích khi xem được danh sách; trang chỉ gọi API `lab_partner` và cờ tự-phục vụ nên không cần quyền module khác.
  'lab_partner.send': ['lab_partner.read'],
  'lab_partner.receive': ['lab_partner.read'],
  'stock_receipt.report': ['drug.read'],
  'stock_issue.read': ['stock_receipt.read', 'drug.read', 'reference_catalog.read'],
  // Phiếu xuất mở rộng có loại "Xuất trả nhà cung cấp" chọn nhà cung cấp → `GET /suppliers` cần `supplier.read` (quét vai trò tuỳ biến 10/11/2026; #291 đã tách quyền này khỏi `drug.*`).
  'stock_issue.create': ['stock_receipt.read', 'drug.read', 'supplier.read', 'reference_catalog.read'],
  'stock_count.read': ['stock_receipt.read', 'drug.read', 'reference_catalog.read'],
  'stock_count.create': ['stock_receipt.read', 'drug.read', 'reference_catalog.read'],
  'stock_transfer.read': ['stock_receipt.read', 'drug.read'],
  'stock_transfer.create': ['stock_receipt.read', 'drug.read'],
  'system_backup.manage': ['system_backup.read'],
  'lab_result.enter': ['result_template.read'],
  'imaging_result.enter': ['result_template.read'],
  'work_shift_assignment.read': ['work_shift.read', 'user_account.read'],
  // "Đơn xin nghỉ" (#224): xin nghỉ cần xem ca đã đăng ký của mình; duyệt/ghi hộ cần xem danh sách đơn.
  'leave_request.create': ['leave_request.read', 'work_shift_assignment.read', 'work_shift.read'],
  'leave_request.approve': ['leave_request.read'],
  // "Đổi ca" (#225): gửi/xác nhận đổi ca cần xem ca đã đăng ký và danh sách yêu cầu.
  'shift_swap.create': ['shift_swap.read', 'work_shift_assignment.read'],
  'work_shift_assignment.approve': ['work_shift_assignment.read'],
  'leave_request.file_on_behalf': ['leave_request.read', 'work_shift_assignment.read', 'work_shift.read'],
  // Thẻ Tỉnh/Thành, Phường/Xã của Danh mục dùng chung và địa chỉ trên Mẫu in gọi `GET /geo/*` — endpoint này nhận cả `reference_catalog.read` (#263) nên không cần gợi ý `patient.read`.
  'reference_catalog.manage': ['reference_catalog.read'],
  'clinic_config.update': ['clinic_config.read', 'reference_catalog.read'],
  'audit_log.read': ['user_account.read'],
};

/** Quyền đi kèm của một quyền (`<module>.<action>`); mảng rỗng nếu không có. */
export function getPermissionCompanions(key: string): readonly string[] {
  return PERMISSION_COMPANIONS[key] ?? [];
}
