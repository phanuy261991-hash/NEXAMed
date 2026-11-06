import type { Prisma } from '@prisma/client';
import { maxDataScope } from '@nexamed/core';
import { findScopesForUserPermission } from '../infrastructure/persistence/permission-lookup.helper';

/**
 * Giá TRẢ đối tác xét nghiệm là giá vốn, khách không được thấy (docs/DECISIONS.md #291): chỉ người cấu hình dịch vụ (`technical_service.update`) hoặc xem công nợ nhà cung cấp
 * (`supplier_debt.read`) thấy con số; mọi người khác (kỹ thuật viên, bác sĩ, lễ tân...) nhận `null`/rỗng. Dùng chung cho form dịch vụ, hàng đợi gửi mẫu và các báo cáo sau này.
 */
export async function canSeePartnerCost(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<boolean> {
  const scopes = [
    ...(await findScopesForUserPermission(tx, tenantId, actorId, 'technical_service', 'update')),
    ...(await findScopesForUserPermission(tx, tenantId, actorId, 'supplier_debt', 'read')),
  ];
  return maxDataScope(scopes) !== 'none';
}
