import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ClinicalOrderCancellationPort } from '@nexamed/core';
import { ClinicalOrderRepository } from '../../modules/clinical-order/clinical-order.repository';

/**
 * Adapter thật cho `ClinicalOrderCancellationPort` — chạy trong ĐÚNG transaction của caller (`tx` được truyền vào, không tự mở transaction riêng), nên việc huỷ lượt khám + đóng
 * hoá đơn chưa thu + đóng dòng chỉ định là một khối nguyên tử. Đăng ký ở `ClinicalOrderCancellationModule` (`@Global()`).
 */
@Injectable()
export class ClinicalOrderCancellationAdapter implements ClinicalOrderCancellationPort {
  constructor(private readonly orderRepository: ClinicalOrderRepository) {}

  cancelNotStartedItems(tx: unknown, tenantId: string, encounterId: string, actorId: string): Promise<number> {
    return this.orderRepository.cancelNotStartedForEncounter(tx as Prisma.TransactionClient, tenantId, encounterId, actorId);
  }
}
