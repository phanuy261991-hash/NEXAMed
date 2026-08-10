import { Injectable } from '@nestjs/common';
import type { InsuranceEligibilityResult, InsuranceGatewayPort } from '@nexamed/core';

/**
 * Adapter no-op cho v1 — cổng giám định BHYT ngoài phạm vi v1 (xem docs/product/prd.md mục 1).
 * Tồn tại và được đăng ký để DI không gọi vào `undefined` (.claude/docs/project-structure.md),
 * nhưng không có service nào gọi tới ở v1.
 */
@Injectable()
export class NoopInsuranceGatewayAdapter implements InsuranceGatewayPort {
  async checkEligibility(_tenantId: string, _cardNo: string): Promise<InsuranceEligibilityResult> {
    throw new Error('NOT_IMPLEMENTED: cổng giám định BHYT chưa triển khai ở v1.');
  }
}
