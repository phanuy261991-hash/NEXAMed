import { Injectable } from '@nestjs/common';
import type { EncounterReaderPort } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { EncounterRepository } from '../../modules/encounter/encounter.repository';

/**
 * Adapter thật (không no-op) cho `EncounterReaderPort` (S5-05, ADM-03) — đọc thẳng `encounter` qua
 * `EncounterRepository` (đã có sẵn), tự mở transaction riêng qua `UnitOfWorkService` (cùng mẫu
 * `PatientReaderAdapter`).
 */
@Injectable()
export class EncounterReaderAdapter implements EncounterReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly encounterRepository: EncounterRepository,
  ) {}

  async findSummariesByIds(
    tenantId: string,
    encounterIds: string[],
  ): Promise<{ id: string; encounterNo: string; patientId: string }[]> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.encounterRepository.findSummariesByIds(tx, tenantId, encounterIds));
  }

  async findIdsByPatientId(tenantId: string, patientId: string): Promise<string[]> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.encounterRepository.findIdsByPatientId(tx, tenantId, patientId));
  }
}
