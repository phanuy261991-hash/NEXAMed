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
    'reference_catalog.read': 'global',
  },
  nurse: {
    'patient.read': 'global',
    'encounter.read': 'personal',
    'vital_sign.create': 'personal',
    'reference_catalog.read': 'global',
  },
  doctor: {
    'patient.read': 'global',
    'appointment.read': 'personal',
    'appointment.create': 'personal',
    'appointment.update': 'personal',
    'appointment.cancel': 'personal',
    'encounter.read': 'global',
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