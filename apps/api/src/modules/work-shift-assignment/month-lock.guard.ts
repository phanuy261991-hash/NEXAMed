import type { Prisma } from '@prisma/client';
import {
  WorkShiftAssignmentMonthLockedError,
  getVietnamDateString,
  isMonthLocked,
  maxDataScope,
  type ClinicConfigReaderPort,
} from '@nexamed/core';
import { findScopesForUserPermission } from '../../infrastructure/persistence/permission-lookup.helper';

/**
 * "Khoá bảng ca" theo tháng (2026-09-03) — tách riêng khỏi `WorkShiftAssignmentService` vì
 * `WorkShiftAssignmentImportService` (Nhập Excel) cũng cần đúng logic này cho `commit()`, tránh
 * trùng lặp. `PermissionGuard` không kiểm được (không có khái niệm điều kiện thời gian, cùng lý do
 * `WorkShiftAssignmentLockedError` cũ) — kiểm thủ công ở tầng Service/ImportService.
 */
export async function canBypassMonthLock(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<boolean> {
  const scopes = await findScopesForUserPermission(tx, tenantId, actorId, 'work_shift_assignment', 'unlock');
  return maxDataScope(scopes) === 'global';
}

/** Ném `WorkShiftAssignmentMonthLockedError` nếu tháng `month` (`YYYY-MM`) đã khoá VÀ actor không
 * có quyền `work_shift_assignment.unlock`. Áp dụng cho MỌI `dataScope` kể cả `global`. */
export async function assertMonthWritable(
  tx: Prisma.TransactionClient,
  clinicConfigReader: ClinicConfigReaderPort,
  tenantId: string,
  actorId: string,
  month: string,
): Promise<void> {
  const graceDays = await clinicConfigReader.getWorkShiftAssignmentLockGraceDays(tenantId);
  if (!isMonthLocked(month, getVietnamDateString(), graceDays)) return;
  if (await canBypassMonthLock(tx, tenantId, actorId)) return;
  throw new WorkShiftAssignmentMonthLockedError();
}
