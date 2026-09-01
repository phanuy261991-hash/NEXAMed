import type { DataScope, UserRole } from '@nexamed/shared';

/**
 * Nguồn sự thật của danh mục permission và ma trận phân quyền mặc định cho 5 vai trò hệ
 * thống — xem .claude/docs/security-audit.md mục "Ma trận mặc định seed cho 5 vai trò hệ
 * thống". Sửa ma trận thì sửa ở đây, KHÔNG sửa trực tiếp dữ liệu trong DB.
 *
 * Đặt ở packages/core vì đây là quy tắc nghiệp vụ thuần (không phụ thuộc Prisma/NestJS) —
 * dùng bởi seed script, guard kiểm quyền, và sau này có thể dùng lại ở web để hiển thị.
 */

export interface PermissionDefinition {
  module: string;
  action: string;
  description: string;
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  { module: 'patient', action: 'read', description: 'Xem hồ sơ hành chính bệnh nhân' },
  { module: 'patient', action: 'create', description: 'Tạo hồ sơ bệnh nhân' },
  { module: 'patient', action: 'update', description: 'Sửa hồ sơ bệnh nhân' },
  { module: 'patient', action: 'merge', description: 'Gộp hồ sơ bệnh nhân trùng' },
  { module: 'appointment', action: 'read', description: 'Xem lịch hẹn' },
  { module: 'appointment', action: 'create', description: 'Tạo lịch hẹn' },
  { module: 'appointment', action: 'update', description: 'Sửa lịch hẹn' },
  { module: 'appointment', action: 'cancel', description: 'Huỷ lịch hẹn' },
  { module: 'encounter', action: 'read', description: 'Xem lượt khám và tiền sử' },
  // 3 permission mới (Sprint 3, Tiếp nhận) — vá lỗ hổng ma trận seed từ S1-04b (chỉ có
  // encounter.read, chưa tính actor nào thực sự tạo/chuyển trạng thái encounter). Xem
  // docs/DECISIONS.md (entry Tiếp nhận) — receptionist check-in tạo encounter, bác sĩ chuyển
  // CHECKED_IN→IN_CONSULTATION, "bỏ về" (CHECKED_IN→CANCELLED) mirror appointment.cancel.
  { module: 'encounter', action: 'create', description: 'Tạo lượt khám (check-in)' },
  { module: 'encounter', action: 'update', description: 'Chuyển trạng thái lượt khám (bắt đầu khám)' },
  { module: 'encounter', action: 'cancel', description: 'Huỷ lượt khám ("bỏ về")' },
  { module: 'vital_sign', action: 'create', description: 'Ghi sinh hiệu' },
  { module: 'diagnosis', action: 'create', description: 'Ghi chẩn đoán' },
  // Ký hồ sơ khám (Sprint 5, S5-02/03) — dùng làm quyền cho "Đính chính chẩn đoán" (mirror
  // `prescription.sign` tái dùng cho cả sign lẫn amend). Bản thân việc KÝ là side-effect của
  // "Hoàn tất khám" (`encounter.update`), không cần kiểm riêng — permission này chỉ gác đúng lúc
  // sửa hồ sơ ĐÃ KÝ. `clinical_note.sign` đã seed sẵn từ trước (dòng dưới), diagnosis thiếu nên
  // thêm ở đây cho đối xứng.
  { module: 'diagnosis', action: 'sign', description: 'Đính chính chẩn đoán đã ký' },
  { module: 'clinical_note', action: 'create', description: 'Ghi chú SOAP' },
  { module: 'clinical_note', action: 'update', description: 'Sửa ghi chú SOAP (trước khi ký)' },
  { module: 'clinical_note', action: 'sign', description: 'Ký ghi chú khám' },
  { module: 'prescription', action: 'create', description: 'Kê đơn thuốc' },
  { module: 'prescription', action: 'sign', description: 'Ký đơn thuốc' },
  { module: 'prescription', action: 'print', description: 'In đơn thuốc' },
  { module: 'clinic_config', action: 'read', description: 'Xem cấu hình phòng khám' },
  { module: 'clinic_config', action: 'update', description: 'Sửa cấu hình phòng khám' },
  { module: 'user_account', action: 'read', description: 'Xem tài khoản người dùng' },
  { module: 'user_account', action: 'manage', description: 'Tạo/sửa/khoá tài khoản, gán vai trò' },
  { module: 'role_permission', action: 'manage', description: 'Cấu hình ma trận phân quyền' },
  { module: 'audit_log', action: 'read', description: 'Xem nhật ký hoạt động' },
  { module: 'reference_catalog', action: 'read', description: 'Xem danh mục dùng chung (dân tộc, quốc tịch...)' },
  { module: 'reference_catalog', action: 'manage', description: 'Thêm/sửa/ẩn mục trong danh mục dùng chung' },
  // Danh mục "Dị nguyên" (docs/DECISIONS.md #069) — permission RIÊNG, không tái dùng
  // reference_catalog.* dù cùng bản chất "danh mục dùng chung toàn hệ thống": Dị nguyên nằm ở
  // trang "Danh mục Chuyên môn" (lâm sàng), reference_catalog nằm ở "Danh mục hành chính" — tách
  // permission theo đúng khu vực trang, cùng lý do icd10_catalog không tái dùng reference_catalog.*.
  { module: 'allergen_catalog', action: 'read', description: 'Xem danh mục Dị nguyên' },
  // `create` tách riêng khỏi `manage` (Sprint 5) — cho phép lễ tân/điều dưỡng/bác sĩ tự thêm dị
  // nguyên mới NGAY lúc nhập Tiền sử (không phải chờ clinic_admin), nhưng KHÔNG cho sửa/ẩn mục đã
  // có (vẫn chỉ clinic_admin qua `manage`, tránh sửa/xoá nhầm dữ liệu dùng chung toàn hệ thống).
  { module: 'allergen_catalog', action: 'create', description: 'Tạo dị nguyên mới (không sửa/ẩn)' },
  { module: 'allergen_catalog', action: 'manage', description: 'Thêm/sửa/ẩn Nhóm dị nguyên và Dị nguyên' },
  // Danh mục thuốc (Sprint 4, S4-03) — theo tenant (khác allergen_catalog/reference_catalog toàn hệ
  // thống). `drug.read` mở cho mọi vai trò lâm sàng (bác sĩ tìm thuốc lúc kê đơn), `drug.manage`
  // chỉ clinic_admin, cùng khuôn reference_catalog.*.
  { module: 'drug', action: 'read', description: 'Xem danh mục thuốc' },
  { module: 'drug', action: 'manage', description: 'Thêm/sửa/ẩn thuốc trong danh mục' },
  // Thu ngân cơ bản (Sprint 5/6, BIL-01→04) — không có `invoice.create` riêng: phiếu thu luôn tạo
  // tự động kèm `encounter.create` (check-in/tiếp nhận trực tiếp), không có endpoint tạo riêng.
  { module: 'invoice', action: 'read', description: 'Xem phiếu thu' },
  { module: 'invoice', action: 'update', description: 'Đánh dấu đã thu/chưa thu, chọn phương thức thanh toán' },
  { module: 'invoice', action: 'print', description: 'In phiếu thu' },
  // #085 — TÁCH khỏi `invoice.update` có chủ đích: "thu tiền vào" và "trả tiền ra khỏi két" là 2
  // mức nhạy cảm khác hẳn nhau. Mặc định CHỈ `clinic_admin` có (lễ tân KHÔNG) — chủ phòng khám tự
  // cấp thêm cho lễ tân qua màn "Vai trò & Phân quyền" nếu tin tưởng/quy mô nhỏ.
  { module: 'invoice', action: 'refund', description: 'Hoàn tiền phiếu thu của lượt khám đã huỷ' },
  // "Tạm nghỉ / Đóng ca" của bác sĩ — RBAC chỉ gác "ai được PHÉP THỬ" (giống mọi permission khác);
  // bác sĩ tự thao tác cho chính mình luôn qua được (scope personal). Lễ tân/clinic_admin thao tác
  // hộ CÒN CẦN THÊM 2 công tắc `ClinicSettings.allowEmergencyEndShift`/`allowReceptionistEndShift`
  // (kiểm trong service, không phải ở đây) — RBAC không phân biệt được ĐANG BẬT/TẮT cấu hình.
  { module: 'doctor_availability', action: 'update', description: 'Đổi trạng thái sẵn sàng nhận bệnh (Tạm nghỉ/Đóng ca) của bác sĩ' },
  // "Đăng ký ca làm việc" (Giai đoạn 2 của #101) — MỌI nhân viên tự đăng ký ca cho chính mình
  // (`create`=personal), tự xoá được TRONG ĐÚNG NGÀY ĐĂNG KÝ (điều kiện thời gian kiểm ở tầng
  // Service, không phải RBAC — cùng lý do 2 công tắc `doctor_availability` không nằm ở đây). Không
  // có action "update" (PATCH) — đổi ca = xoá rồi đăng ký lại, đơn giản hơn PATCH nhiều trường.
  // `create`/`read`/`delete` scope `global` (mặc định CHỈ clinic_admin) là NGƯỜI QUẢN LÝ tạo/xem/
  // xoá HỘ toàn bộ nhân viên, không giới hạn thời gian. Đây là ca ĐẦU TIÊN trong dự án một
  // permission có scope khác nhau THEO VAI TRÒ cho CÙNG action (`create`: personal cho 4 vai trò
  // thường, global cho clinic_admin) — không có tiền lệ tương tự trước đó.
  { module: 'work_shift_assignment', action: 'create', description: 'Đăng ký ca làm việc (cho chính mình, hoặc hộ người khác nếu có quyền quản lý)' },
  { module: 'work_shift_assignment', action: 'read', description: 'Xem lịch làm việc đã đăng ký' },
  { module: 'work_shift_assignment', action: 'delete', description: 'Xoá ca làm việc đã đăng ký (của người khác, hoặc quá hạn tự xoá)' },
] as const;

export function permissionKey(p: Pick<PermissionDefinition, 'module' | 'action'>): string {
  return `${p.module}.${p.action}`;
}

/**
 * Ma trận mặc định — lý do `doctor.encounter.read = global` (không phải `personal` +
 * break-glass như ví dụ minh hoạ chung của ngành) xem giải thích trong security-audit.md:
 * PRD ENC-01 (P0) yêu cầu bác sĩ xem toàn bộ tiền sử ngay, kể cả lượt khám do bác sĩ khác
 * phụ trách — phòng khám 1-3 bác sĩ thường thay nhau khám cùng bệnh nhân.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Partial<Record<string, DataScope>>> = {
  receptionist: {
    'patient.read': 'global',
    'patient.create': 'global',
    'patient.update': 'global',
    'appointment.read': 'global',
    'appointment.create': 'global',
    'appointment.update': 'global',
    'appointment.cancel': 'global',
    // Tiếp nhận (Sprint 3) — lễ tân check-in (tạo encounter) + xem hàng đợi. Trước đây
    // encounter.read = none (chưa từng chốt lễ tân xem lượt khám) — đổi vì hàng đợi Tiếp nhận
    // chính là danh sách encounter đang CHECKED_IN/IN_CONSULTATION, đây là công việc thường ngày
    // của lễ tân, không phải xem dữ liệu lâm sàng nhạy cảm (chẩn đoán/ghi chú SOAP vẫn ở module
    // encounter/khám bệnh riêng, chưa cấp quyền nào ở đây).
    'encounter.read': 'global',
    'encounter.create': 'global',
    'encounter.cancel': 'global',
    'reference_catalog.read': 'global',
    'allergen_catalog.read': 'global',
    'allergen_catalog.create': 'global',
    'drug.read': 'global',
    // Thu ngân cơ bản — lễ tân là người thu tiền chính (PRD mục 4.7 "Là lễ tân...").
    'invoice.read': 'global',
    'invoice.update': 'global',
    'invoice.print': 'global',
    // "Tạm nghỉ / Đóng ca" hộ bác sĩ — chỉ thật sự dùng được khi phòng khám bật thêm
    // `allowReceptionistEndShift` (mặc định tắt), xem PERMISSIONS ở trên.
    'doctor_availability.update': 'global',
    // "Đăng ký ca làm việc" (Giai đoạn 2 #101) — tự đăng ký cho chính mình, chỉ xem/sửa/xoá của
    // riêng mình (không có 'read'/'update'/'delete' global — đó là quyền quản lý, mặc định chỉ
    // clinic_admin, xem bên dưới).
    'work_shift_assignment.create': 'personal',
    'work_shift_assignment.read': 'personal',
    'work_shift_assignment.delete': 'personal',
  },
  nurse: {
    'patient.read': 'global',
    // Đổi personal→global (Sprint 3, Tiếp nhận): "personal" theo .claude/docs/security-audit.md
    // nghĩa là chủ = encounter.doctor_id — điều dưỡng không phải bác sĩ nên scope này chưa từng
    // thật sự cho phép truy cập gì (luôn rỗng). Phòng khám 1-3 bác sĩ, điều dưỡng phục vụ mọi bác
    // sĩ — cùng lý do doctor.encounter.read=global đã chốt trước đó.
    'encounter.read': 'global',
    'vital_sign.create': 'global',
    'reference_catalog.read': 'global',
    'allergen_catalog.read': 'global',
    'allergen_catalog.create': 'global',
    'drug.read': 'global',
    'work_shift_assignment.create': 'personal',
    'work_shift_assignment.read': 'personal',
    'work_shift_assignment.delete': 'personal',
  },
  doctor: {
    'patient.read': 'global',
    // Đổi từ chỉ đọc sang có sửa (global, cùng mức receptionist/clinic_admin — hệ thống chưa có
    // quyền theo từng trường riêng) — bác sĩ cập nhật "Tiền sử dị ứng" ngay trong màn khám cần ghi
    // thẳng lại `patient.allergyNote`, không chỉ lưu riêng cho lượt khám (yêu cầu chủ dự án
    // 2026-08-20, xem docs/DECISIONS.md).
    'patient.update': 'global',
    'appointment.read': 'personal',
    'appointment.create': 'personal',
    'appointment.update': 'personal',
    'appointment.cancel': 'personal',
    'encounter.read': 'global',
    // Bắt đầu khám (CHECKED_IN→IN_CONSULTATION) chỉ cho lượt khám do chính bác sĩ phụ trách —
    // mirror appointment.update=personal đã có. "Bỏ về" mirror appointment.cancel=personal.
    'encounter.update': 'personal',
    'encounter.cancel': 'personal',
    'vital_sign.create': 'personal',
    'diagnosis.create': 'personal',
    'diagnosis.sign': 'personal',
    'clinical_note.create': 'personal',
    'clinical_note.update': 'personal',
    'clinical_note.sign': 'personal',
    'prescription.create': 'personal',
    'prescription.sign': 'personal',
    'prescription.print': 'personal',
    'reference_catalog.read': 'global',
    'allergen_catalog.read': 'global',
    'allergen_catalog.create': 'global',
    'drug.read': 'global',
    // Tự thao tác "Tạm nghỉ / Đóng ca" cho chính mình — luôn cho phép (personal), không phụ thuộc
    // 2 công tắc cấu hình (2 công tắc đó chỉ gate nhánh "hộ" của receptionist/clinic_admin).
    'doctor_availability.update': 'personal',
    'work_shift_assignment.create': 'personal',
    'work_shift_assignment.read': 'personal',
    'work_shift_assignment.delete': 'personal',
  },
  clinic_admin: {
    'patient.read': 'global',
    'patient.create': 'global',
    'patient.update': 'global',
    'patient.merge': 'global',
    'appointment.read': 'global',
    'appointment.create': 'global',
    'appointment.update': 'global',
    'appointment.cancel': 'global',
    // Cần global cho cả 3 để clinic_admin quản lý được toàn bộ Tiếp nhận, cùng mức appointment.*.
    'encounter.read': 'global',
    'encounter.create': 'global',
    'encounter.cancel': 'global',
    'clinic_config.read': 'global',
    'clinic_config.update': 'global',
    'user_account.read': 'global',
    'user_account.manage': 'global',
    'role_permission.manage': 'global',
    'audit_log.read': 'global',
    'reference_catalog.read': 'global',
    'reference_catalog.manage': 'global',
    'allergen_catalog.read': 'global',
    'allergen_catalog.create': 'global',
    'allergen_catalog.manage': 'global',
    'drug.read': 'global',
    'drug.manage': 'global',
    // Thu ngân cơ bản — clinic_admin giám sát/xử lý được như lễ tân, cùng mức encounter.*.
    'invoice.read': 'global',
    'invoice.update': 'global',
    'invoice.print': 'global',
    // #085 — DUY NHẤT clinic_admin có sẵn quyền hoàn tiền (lễ tân không, xem comment ở
    // PERMISSION_CATALOG). Tenant đã cài sẵn tự được vá dòng này lúc API khởi động qua
    // `syncRolePermissionsForAllTenants()`, không cần thao tác tay.
    'invoice.refund': 'global',
    'doctor_availability.update': 'global',
    // Người quản lý — xem/tạo/xoá TOÀN BỘ lịch làm việc nhân viên, không giới hạn thời gian tự sửa
    // (khác `personal` của 4 vai trò còn lại). `create=global` (khác 4 vai trò kia) — bắt buộc để
    // màn "Lịch làm việc nhân viên" tạo ca HỘ bất kỳ nhân viên nào (`userId` trong body mới có tác
    // dụng ở scope `global`, xem `WorkShiftAssignmentService.create()`); vẫn tự đăng ký cho chính
    // mình bình thường khi bỏ trống `userId`. Không có action "update" (PATCH) thật nào trong API —
    // đổi ca = xoá rồi tạo lại (đơn giản hơn PATCH nhiều trường), permission `update` giữ lại trong
    // catalog chỉ để đối xứng CRUD, chưa gắn route nào.
    'work_shift_assignment.create': 'global',
    'work_shift_assignment.read': 'global',
    'work_shift_assignment.delete': 'global',
  },
  system_admin: {
    'user_account.read': 'global',
    'user_account.manage': 'global',
    'audit_log.read': 'global',
  },
};