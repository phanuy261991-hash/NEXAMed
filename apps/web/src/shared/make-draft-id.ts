/**
 * ID cục bộ cho 1 dòng nháp chưa lưu (key React trong danh sách thêm/xoá dòng động — ví dụ
 * "Đơn giá dịch vụ" ở `ExamTypeFormModal.tsx`, "Chỉ định dịch vụ khám" ở `ReceptionIntakeForm.tsx`,
 * docs/DECISIONS.md #080). KHÔNG phải id thật gửi lên server — server tự sinh `id` khi lưu.
 */
export function makeDraftId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `draft-${Math.random().toString(36).slice(2)}`;
}
