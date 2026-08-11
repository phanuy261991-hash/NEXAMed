import { DomainError } from './domain-error';

/** DB trả unique violation trên `(tenant_id, national_id_hash)` — chặn trùng CCCD (PAT-03). */
export class PatientDuplicateNationalIdError extends DomainError {
  readonly code = 'PATIENT_DUPLICATE_NATIONAL_ID';

  constructor() {
    super('Đã có bệnh nhân khác dùng số CCCD/CMND này trong phòng khám.');
  }
}
