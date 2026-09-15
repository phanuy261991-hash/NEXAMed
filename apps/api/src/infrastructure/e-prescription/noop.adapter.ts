import { Injectable } from '@nestjs/common';
import type { EPrescriptionGatewayPort, EPrescriptionSubmission, EPrescriptionSubmissionResult } from '@nexamed/core';

/**
 * Adapter no-op cho v1 — cổng Đơn thuốc quốc gia ngoài phạm vi v1 (xem docs/product/prd.md
 * Appendix A, v3). Tồn tại và được đăng ký để DI không gọi vào `undefined`
 * (.claude/docs/project-structure.md), nhưng không có service nào gọi tới ở v1.
 */
@Injectable()
export class NoopEPrescriptionGatewayAdapter implements EPrescriptionGatewayPort {
  async sendPrescription(_submission: EPrescriptionSubmission): Promise<EPrescriptionSubmissionResult> {
    throw new Error('NOT_IMPLEMENTED: cổng Đơn thuốc quốc gia chưa triển khai ở v1.');
  }
}
