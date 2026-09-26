import type { Prisma } from '@prisma/client';
import { maxDataScope, SupplierDebtPeriodLockedError } from '@nexamed/core';
import { findScopesForUserPermission } from '../../infrastructure/persistence/permission-lookup.helper';

/**
 * Phần E "Đối chiếu & chốt công nợ theo kỳ" (docs/DECISIONS.md #182 câu 3) — tách riêng khỏi
 * `SupplierDebtService` cùng lý do `month-lock.guard.ts` (#110) được tách khỏi
 * `WorkShiftAssignmentService`: dễ tìm, dễ tái dùng nếu có thêm nơi cần kiểm.
 */
export async function canBypassSupplierDebtLock(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<boolean> {
  const scopes = await findScopesForUserPermission(tx, tenantId, actorId, 'supplier_debt', 'unlock');
  return maxDataScope(scopes) === 'global';
}

/** Ném `SupplierDebtPeriodLockedError` nếu `documentOccurredAt` (ngày chứng từ GỐC đang bị
 * Huỷ/Điều chỉnh) rơi vào kỳ đã chốt (`lockedAsOfDate` khác null và `documentOccurredAt <=
 * lockedAsOfDate`) VÀ actor không có quyền `supplier_debt.unlock` (scope `global`). */
export async function assertSupplierDebtWritable(
  tx: Prisma.TransactionClient,
  tenantId: string,
  actorId: string,
  lockedAsOfDate: Date | null,
  documentOccurredAt: Date,
): Promise<void> {
  if (!lockedAsOfDate || documentOccurredAt.getTime() > lockedAsOfDate.getTime()) return;
  if (await canBypassSupplierDebtLock(tx, tenantId, actorId)) return;
  throw new SupplierDebtPeriodLockedError();
}
