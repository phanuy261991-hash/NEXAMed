/**
 * Định dạng mã ngắn tuần tự `<prefix><seq5>` (ví dụ `HV00001`) — dùng cho các danh mục quản lý
 * qua UI có mã tự sinh (Học vị/Chức danh/Trạng thái-Hình thức làm việc/Đơn vị tính/Hình thức
 * thanh toán, Nhóm dị nguyên/Dị nguyên, Ca làm việc). Thay hoàn toàn cơ chế ngẫu nhiên cũ
 * (`generateReferenceCatalogCode`/`generateAllergenCode`...) theo yêu cầu chủ dự án 2026-09-03 —
 * xem docs/DECISIONS.md #113. Khác `formatDisplayCode` (mã nghiệp vụ có tháng-năm, patient_code/
 * encounter_no...) — nhóm mã này KHÔNG có ý nghĩa theo tháng nên không cần thành phần ngày.
 *
 * `seq` do `GlobalCodeSequenceRepository` (danh mục toàn hệ thống) hoặc `CodeSequenceRepository`
 * (Ca làm việc — theo tenant) cấp atomic; hàm này chỉ định dạng chuỗi, thuần không phụ thuộc DB.
 */
export function formatShortSequentialCode(prefix: string, seq: number | bigint): string {
  const seqStr = seq.toString().padStart(5, '0');
  return `${prefix}${seqStr}`;
}
