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
    'clinical_note.create': 'personal',
    'clinical_note.update': 'personal',
    'clinical_note.sign': 'personal',
    'prescription.create': 'personal',
    'prescription.sign': 'personal',
    'prescription.print': 'personal',
    'reference_catalog.read': 'global',
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
  },
  system_admin: {
    'user_account.read': 'global',
    'user_account.manage': 'global',
    'audit_log.read': 'global',
  },
};