import { Injectable } from '@nestjs/common';
import type { PatientReaderPort } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { PatientRepository } from '../../modules/patient/patient.repository';

/**
 * Adapter thật (không no-op) cho `PatientReaderPort` (S5-05, ADM-03) — đọc thẳng `patient` qua
 * `PatientRepository` (đã có sẵn), tự mở transaction riêng qua `UnitOfWorkService` (cùng mẫu
 * `DoctorDirectoryAdapter`/`ReferenceCatalogReaderAdapter`) vì port chỉ nhận `tenantId`, không có
 * `tx` sẵn từ caller.
 */
@Injectable()
export class PatientReaderAdapter implements PatientReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly patientRepository: PatientRepository,
  ) {}

  async findSummariesByIds(
    tenantId: string,
    patientIds: string[],
  ): Promise<{ id: string; fullName: string; patientCode: string }[]> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.patientRepository.findSummariesByIds(tx, tenantId, patientIds));
  }
}
