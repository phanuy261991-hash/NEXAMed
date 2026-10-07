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
  'encounter.create': ['encounter.read', 'patient.read', 'appointment.read', 'allergen_catalog.read', 'reference_catalog.read'],
  'invoice.read': ['cashier_shift.read', 'reference_catalog.read'],
  'cashier_shift.read': ['user_account.read'],
  'cash_voucher.read': ['cash_account.read', 'reference_catalog.read'],
  'stock_receipt.read': ['drug.read', 'cash_account.read', 'reference_catalog.read'],
  'stock_receipt.create': ['drug.read', 'cash_account.read', 'reference_catalog.read'],
  'stock_receipt.report': ['drug.read'],
  'stock_issue.read': ['stock_receipt.read', 'drug.read', 'reference_catalog.read'],
  'stock_issue.create': ['stock_receipt.read', 'drug.read', 'reference_catalog.read'],
  'stock_count.read': ['stock_receipt.read', 'drug.read', 'reference_catalog.read'],
  'stock_count.create': ['stock_receipt.read', 'drug.read', 'reference_catalog.read'],
  'stock_transfer.read': ['stock_receipt.read', 'drug.read'],
  'stock_transfer.create': ['stock_receipt.read', 'drug.read'],
  'system_backup.manage': ['system_backup.read'],
  'lab_result.enter': ['result_template.read'],
  'imaging_result.enter': ['result_template.read'],
  'work_shift_assignment.read': ['work_shift.read', 'user_account.read'],
  'reference_catalog.manage': ['reference_catalog.read'],
  'clinic_config.update': ['clinic_config.read'],
  'audit_log.read': ['user_account.read'],
};

/** Quyền đi kèm của một quyền (`<module>.<action>`); mảng rỗng nếu không có. */
export function getPermissionCompanions(key: string): readonly string[] {
  return PERMISSION_COMPANIONS[key] ?? [];
}
