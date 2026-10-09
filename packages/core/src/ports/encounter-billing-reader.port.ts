import type { EncounterBillingSummary } from '../billing/encounter-billing-summary';

/**
 * Tóm tắt chi phí theo lượt khám cho tab "Lịch sử khám chữa bệnh" (docs/DECISIONS.md #223). `encounter` KHÔNG import thẳng `BillingModule` nên đọc qua port này; adapter thật
 * đăng ký ở module `@Global()` riêng bên `billing` (cùng khuôn `ParaclinicalProgressReaderPort`). Chỉ đọc, tự mở transaction riêng.
 *
 * Lượt khám không có hoá đơn nào còn hiệu lực thì KHÔNG có khoá trong kết quả.
 */
export interface EncounterBillingReaderPort {
  getSummaryByEncounter(tenantId: string, encounterIds: string[]): Promise<Map<string, EncounterBillingSummary>>;
}

export const ENCOUNTER_BILLING_READER_PORT = Symbol('ENCOUNTER_BILLING_READER_PORT');
