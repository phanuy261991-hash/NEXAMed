/**
 * Cổng giám định BHYT — xem .claude/docs/project-structure.md bảng Port/adapter. Ngoài phạm vi
 * v1 (PRD mục 1 "Ngoài phạm vi v1": tích hợp BHYT và cổng giám định). Port khai báo sẵn để
 * `insurance_card`/`encounter.insurance_snapshot` (v1, chỉ lưu và hiển thị) có chỗ nối vào khi
 * tích hợp thật ở v3 — v1 adapter no-op, luôn báo chưa triển khai, không có service nào gọi.
 */
export interface InsuranceEligibilityResult {
  eligible: boolean;
  benefitRatePercent?: number;
}

export interface InsuranceGatewayPort {
  checkEligibility(tenantId: string, cardNo: string): Promise<InsuranceEligibilityResult>;
}

export const INSURANCE_GATEWAY_PORT = Symbol('INSURANCE_GATEWAY_PORT');
