import { Injectable } from '@nestjs/common';
import type { PatientIdentityPort } from '@nexamed/core';

/**
 * Adapter v1 cho PatientIdentityPort — trả chính `patient.id` trong tenant hiện tại, khớp
 * `patient.global_patient_ref` luôn null ở v1. Xem .claude/docs/multi-tenancy.md điểm 6.
 */
@Injectable()
export class SameTenantPatientIdentityAdapter implements PatientIdentityPort {
  async resolveGlobalRef(_tenantId: string, patientId: string): Promise<string> {
    return patientId;
  }
}
