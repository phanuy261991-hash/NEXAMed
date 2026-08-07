import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestTenantContext {
  tenantId?: string;
  actorId?: string;
}

/**
 * Giữ tenantId/actorId của request hiện tại xuyên suốt call stack bất đồng bộ, không cần
 * truyền tay qua từng tham số hàm. Được set bởi TenantContextMiddleware (apps/api/src/common),
 * đọc bởi UnitOfWorkService khi mở transaction.
 */
export const tenantContextStorage = new AsyncLocalStorage<RequestTenantContext>();