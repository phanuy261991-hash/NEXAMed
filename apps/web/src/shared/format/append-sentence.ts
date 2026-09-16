/**
 * Ghép 1 câu gợi ý vào cuối ô text tự do — dùng cho combobox "Thời điểm dùng thuốc"
 * (docs/DECISIONS.md #155) chèn câu "Quy tắc thời gian chi tiết" vào `drug.usageInstruction`/
 * `prescriptionItem.instruction` có sẵn, KHÔNG lưu thành cột riêng. Dùng chung giữa
 * `DrugCatalogPane.tsx`/`PrescriptionPanel.tsx`.
 */
export function appendSentence(current: string, addition: string): string {
  const trimmed = current.trim();
  if (trimmed === '') return addition;
  const separator = /[.!?]$/.test(trimmed) ? ' ' : '. ';
  return `${trimmed}${separator}${addition}`;
}
