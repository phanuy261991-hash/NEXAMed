/**
 * Tiến độ cận lâm sàng LÀM TẠI PHÒNG KHÁM của từng lượt khám, cho "Hàng đợi khám" của bác sĩ (docs/DECISIONS.md #221). `reception` KHÔNG import thẳng `ClinicalOrderModule`
 * nên đọc qua port này; adapter thật đăng ký ở module `@Global()` riêng bên `clinical-order` (cùng khuôn `ClinicalOrderCancellationPort`/`StockAvailabilityPort`).
 *
 * Chỉ tính dòng chỉ định LÀ dịch vụ kỹ thuật làm tại phòng khám (xét nghiệm / CĐHA / thăm dò) — dịch vụ khám, dòng tự do và chỉ định ra ngoài không có kết quả để chờ.
 */
export interface ParaclinicalProgress {
  /** Số dịch vụ chưa có kết quả được duyệt (ORDERED / IN_PROGRESS / RESULTED, kể cả kết quả đang đính chính). */
  pendingCount: number;
  /** Số kết quả ĐÃ duyệt mà bác sĩ phụ trách chưa mở xem (`doctor_seen_at` rỗng). */
  unseenResultCount: number;
}

export interface ParaclinicalProgressReaderPort {
  /** Chỉ trả các lượt khám có ít nhất 1 dịch vụ cận lâm sàng tại phòng khám; lượt không có thì không có khoá. */
  getProgressByEncounter(tenantId: string, encounterIds: string[]): Promise<Map<string, ParaclinicalProgress>>;
  /** Số bệnh nhân (lượt khám đang khám của bác sĩ) có kết quả mới chưa xem — chấm số ở menu "Hàng đợi khám". */
  countEncountersWithUnseenResults(tenantId: string, doctorId: string): Promise<number>;
}

export const PARACLINICAL_PROGRESS_READER_PORT = Symbol('PARACLINICAL_PROGRESS_READER_PORT');
