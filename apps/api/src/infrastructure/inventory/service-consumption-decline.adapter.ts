import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ActiveServiceConsumption, ServiceConsumptionDeclinePort } from '@nexamed/core';
import { ServiceConsumptionService } from '../../modules/inventory/service-consumption.service';

/**
 * Adapter của `ServiceConsumptionDeclinePort` (xem `packages/core/src/ports/service-consumption-decline.port.ts`): chuyển thẳng sang `ServiceConsumptionService` của kho,
 * chạy TRONG transaction của người gọi (nhận `tx`) nên KHÔNG tự mở transaction — đúng quy tắc "một request = một transaction" (#264). Đăng ký ở
 * `ServiceConsumptionDeclineModule` (`@Global()`).
 */
@Injectable()
export class ServiceConsumptionDeclineAdapter implements ServiceConsumptionDeclinePort {
  constructor(private readonly service: ServiceConsumptionService) {}

  describeActive(tx: unknown, tenantId: string, branchId: string, actorId: string, orderItemIds: string[]): Promise<{ canReverse: boolean; items: ActiveServiceConsumption[] }> {
    return this.service.describeActiveForDecline(tx as Prisma.TransactionClient, tenantId, branchId, actorId, orderItemIds);
  }

  reverse(tx: unknown, tenantId: string, branchId: string, actorId: string, issueId: string, reason: string, meta: { ip: string | null; userAgent: string | null }): Promise<void> {
    return this.service.reverseForDecline(tx as Prisma.TransactionClient, tenantId, branchId, actorId, issueId, reason, meta);
  }
}
