import { Injectable } from '@nestjs/common';
import type { InteropEncounterSnapshot, InteropSubmissionSourcePort } from '@nexamed/core';
import { PrescriptionInteropDataService } from '../../modules/encounter/prescription-interop-data.service';

/**
 * Adapter thật cho `InteropSubmissionSourcePort` (docs/DECISIONS.md #242 GĐ3) — gom dữ liệu gửi đơn thuốc liên thông qua `PrescriptionInteropDataService` (module lượt khám). Đăng ký ở
 * `PrescriptionInteropSourceModule` (@Global): module liên thông chỉ `@Inject(INTEROP_SUBMISSION_SOURCE_PORT)`, không import module lượt khám.
 */
@Injectable()
export class InteropSubmissionSourceAdapter implements InteropSubmissionSourcePort {
  constructor(private readonly dataService: PrescriptionInteropDataService) {}

  async loadForEncounter(tenantId: string, encounterId: string): Promise<InteropEncounterSnapshot | null> {
    const gathered = await this.dataService.gather(tenantId, encounterId);
    if (!gathered || !gathered.prescription?.signed || gathered.kinds.length === 0) return null;
    return {
      branchId: gathered.branchId,
      doctorUserId: gathered.prescription.signedBy,
      doctorName: gathered.doctorName,
      inputs: gathered.kinds.filter((k) => k.nationalCode !== null).map((k) => k.input),
    };
  }
}
