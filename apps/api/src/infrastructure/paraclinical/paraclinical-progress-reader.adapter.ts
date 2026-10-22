import { Injectable } from '@nestjs/common';
import type { ParaclinicalProgress, ParaclinicalProgressReaderPort, ParaclinicalResultCounts } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { ClinicalOrderRepository } from '../../modules/clinical-order/clinical-order.repository';

/**
 * Adapter thật cho `ParaclinicalProgressReaderPort` — chỉ đọc, tự mở transaction riêng qua `UnitOfWorkService` (port chỉ nhận `tenantId`, cùng khuôn
 * `ParaclinicalResultsReaderAdapter`). Đăng ký ở `ParaclinicalProgressReaderModule` (`@Global()`).
 */
@Injectable()
export class ParaclinicalProgressReaderAdapter implements ParaclinicalProgressReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly orderRepository: ClinicalOrderRepository,
  ) {}

  getProgressByEncounter(tenantId: string, encounterIds: string[]): Promise<Map<string, ParaclinicalProgress>> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.orderRepository.progressByEncounterIds(tx, tenantId, encounterIds));
  }

  getProgressForDay(tenantId: string, branchId: string, dayStart: Date, dayEnd: Date): Promise<Map<string, ParaclinicalProgress>> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.orderRepository.progressForDay(tx, tenantId, branchId, dayStart, dayEnd));
  }

  getResultCountsByEncounter(tenantId: string, encounterIds: string[]): Promise<Map<string, ParaclinicalResultCounts>> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.orderRepository.resultCountsByEncounterIds(tx, tenantId, encounterIds));
  }

  countEncountersWithUnseenResults(tenantId: string, branchId: string, doctorId: string): Promise<number> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.orderRepository.countEncountersWithUnseenResults(tx, tenantId, branchId, doctorId));
  }
}
