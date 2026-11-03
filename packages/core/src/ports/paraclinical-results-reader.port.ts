import type { MedicalRecordDeclinedItem, MedicalRecordParaclinicalResult } from '../medical-record/render-patient-medical-record-html';

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

  /**
   * `Record<encounterId, dịch vụ khách không làm>` (docs/DECISIONS.md #280) — các dòng chỉ định thu ngân đã bỏ ở quầy, kèm TÊN lý do (tra từ danh mục, rơi về mã nếu mục đã ẩn) và tên
   * người xác nhận; lượt khám không có dòng nào thì không có khoá. Cùng cổng với kết quả cận lâm sàng vì cùng là "chỉ định cận lâm sàng của lượt khám" và để `encounter` không import
   * thêm module nào. Tự mở transaction đọc riêng nên PHẢI gọi TRƯỚC khi mở transaction chính.
   */
  listDeclinedForEncounters(tenantId: string, encounterIds: string[]): Promise<Record<string, MedicalRecordDeclinedItem[]>>;
}

export const PARACLINICAL_RESULTS_READER_PORT = Symbol('PARACLINICAL_RESULTS_READER_PORT');
