import type { MedicalRecordParaclinicalResult } from '../medical-record/render-patient-medical-record-html';

/**
 * Đọc kết quả cận lâm sàng ĐÃ DUYỆT của các lượt khám để đưa vào "Xuất bệnh án PDF" (`EncounterService.exportMedicalRecordPdf()`). `encounter` KHÔNG import thẳng
 * `ParaclinicalResultModule` (ranh giới module — giao tiếp qua port, cùng khuôn `StockAvailabilityPort`); adapter thật đăng ký ở một module `@Global()` riêng
 * (`apps/api/src/modules/paraclinical-result/paraclinical-results-reader.module.ts`).
 */
export interface ParaclinicalResultsReaderPort {
  /**
   * `Record<encounterId, kết quả>` — chỉ kết quả đã duyệt (bản ký còn hiệu lực), theo thứ tự chỉ định; lượt khám không có kết quả nào thì không có khoá. Bản nháp,
   * đang nhập hoặc đang đính chính KHÔNG có mặt.
   */
  listSignedForEncounters(tenantId: string, encounterIds: string[]): Promise<Record<string, MedicalRecordParaclinicalResult[]>>;
}

export const PARACLINICAL_RESULTS_READER_PORT = Symbol('PARACLINICAL_RESULTS_READER_PORT');
