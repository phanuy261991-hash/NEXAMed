/**
 * Đính chính `diagnosis` (Sprint 5, S5-02/03) — khác `prescription` (có "header" 1 dòng/lượt khám),
 * `diagnosis` là DANH SÁCH nhiều dòng nên không có một `id` duy nhất để gắn `supersedesId`. Ghép
 * cặp dòng MỚI với dòng CŨ theo `(icd10Code, type)` không đổi giữa 2 lần đính chính — giữ đúng
 * chuỗi lịch sử cho chẩn đoán không đổi qua các lần sửa; mã thực sự mới (không khớp dòng cũ nào)
 * thì `supersedesId=null`. Thuần, không phụ thuộc DB/framework — dùng ở `DiagnosisRepository`.
 */

export interface DiagnosisAmendmentOldItem {
  id: string;
  icd10Code: string;
  type: 'PRIMARY' | 'SECONDARY';
}

export interface DiagnosisAmendmentNewItem {
  icd10Code: string;
  type: 'PRIMARY' | 'SECONDARY';
  note: string | null;
}

export interface DiagnosisAmendmentPairedItem extends DiagnosisAmendmentNewItem {
  supersedesId: string | null;
}

export function pairDiagnosisAmendment(oldItems: DiagnosisAmendmentOldItem[], newItems: DiagnosisAmendmentNewItem[]): DiagnosisAmendmentPairedItem[] {
  const remaining = [...oldItems];
  return newItems.map((item) => {
    const idx = remaining.findIndex((old) => old.icd10Code === item.icd10Code && old.type === item.type);
    if (idx === -1) {
      return { ...item, supersedesId: null };
    }
    const [matched] = remaining.splice(idx, 1);
    return { ...item, supersedesId: matched!.id };
  });
}
