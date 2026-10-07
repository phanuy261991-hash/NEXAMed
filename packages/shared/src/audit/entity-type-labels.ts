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
  invoice_refund: 'Phiếu hoàn tiền',
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
  print_template: 'Mẫu in',
  technical_service: 'Dịch vụ kỹ thuật',
  lab_indicator: 'Chỉ số xét nghiệm',
  result_template: 'Mẫu kết quả',
  service_package: 'Gói dịch vụ',
  price_list: 'Bảng giá',
  clinical_order: 'Phiếu chỉ định cận lâm sàng',
  paraclinical_result: 'Kết quả cận lâm sàng',
  doctor_room_session: 'Phòng làm việc',
  break_glass_session: 'Quyền khẩn cấp (break-glass)',
  // Bổ sung #109 — thiếu từ lúc thêm module work_shift/work_shift_assignment (#101/#102) và
  // doctor_availability (#094), cùng `tenant_setting` (đã có action `clinic_settings.updated`
  // dùng entityType này từ S2-07 nhưng chưa từng có nhãn).
  work_shift: 'Ca làm việc',
  work_shift_assignment: 'Đăng ký ca làm việc',
  doctor_availability: 'Trạng thái làm việc bác sĩ',
  tenant_setting: 'Cấu hình phòng khám',
  cashier_shift: 'Phiếu chốt ca',
  // "Công nợ nhà cung cấp" (docs/DECISIONS.md #180/#182) — thêm nhãn NGAY từ đầu, tránh lặp lại lỗ
  // hổng "quên nhãn tiếng Việt" đã ghi chú nhiều lần ở permission-grouping.ts.
  supplier: 'Nhà cung cấp',
  supplier_debt_account: 'Sổ công nợ nhà cung cấp',
  supplier_debt_entry: 'Bút toán công nợ nhà cung cấp',
  supplier_debt_adjustment: 'Phiếu điều chỉnh công nợ NCC',
  supplier_debt_reconciliation: 'Biên bản đối chiếu công nợ NCC',
  warehouse: 'Kho',
  stock_receipt: 'Phiếu nhập kho',
  stock_issue: 'Phiếu xuất kho',
  stock_count: 'Phiếu kiểm kê',
  stock_transfer: 'Phiếu điều chuyển kho',
  stock_ledger_report: 'Báo cáo Nhập-Xuất-Tồn',
  cash_account: 'Quỹ',
  cash_voucher: 'Phiếu thu/chi',
  cash_book_export: 'Báo cáo dòng tiền',
  patient_wallet: 'Ví tạm ứng',
  prescription_template: 'Đơn thuốc mẫu',
  reception_list_export: 'Danh sách tiếp nhận',
};

export function labelForEntityType(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}
