/**
 * Nhãn tiếng Việt cho field/giá trị trong `beforeJson`/`afterJson` của `audit_log` — "Nhật ký hoạt
 * động" (S5-05). Khai TẠI ĐÂY (không phải `packages/shared`) vì chỉ `apps/web` dùng (backend chỉ
 * trả `beforeJson`/`afterJson` thô, không tự dịch) — và vì hàm thuần dạng này re-export qua barrel
 * `packages/shared` bị đúng lỗi bundler đã biết (Rollup/Vite không dò được named export hàm thuần
 * qua `__exportStar` khi import trực tiếp CJS dist trong dev, xem `docs/DECISIONS.md` #032).
 *
 * Field/giá trị lạ (chưa có trong map) hiện nguyên văn — vẫn tốt hơn ẩn hẳn, và map lớn dần theo
 * thời gian giống `ACTION_LABELS` (`packages/shared/src/audit/action-labels.ts`, dùng ở backend) —
 * KHÔNG thể phủ hết mọi field của mọi entity trong 1 lần, chủ dự án phát hiện thêm thì bổ sung tiếp.
 */
const FIELD_LABELS: Record<string, string> = {
  amount: 'Số tiền',
  method: 'Phương thức',
  fullName: 'Họ tên',
  phone: 'Số điện thoại',
  status: 'Trạng thái',
  cancelReason: 'Lý do huỷ',
  amendmentReason: 'Lý do đính chính',
  reason: 'Lý do',
  quantity: 'Số lượng',
  examTypeCode: 'Loại khám',
  examTypeName: 'Tên loại khám',
  examTypePrice: 'Đơn giá',
  priceTypeCode: 'Loại giá dịch vụ',
  unitCode: 'Đơn vị tính',
  roleId: 'Vai trò',
  roleIds: 'Danh sách vai trò',
  roleName: 'Tên vai trò',
  dataScope: 'Phạm vi dữ liệu',
  targetPatientId: 'Bệnh nhân đích',
  sourcePatientId: 'Bệnh nhân nguồn',
  doctorId: 'Bác sĩ',
  departmentId: 'Khoa/Phòng',
  chiefComplaint: 'Lý do khám',
  diagnosis: 'Chẩn đoán',
  icd10Code: 'Mã ICD-10',
  isActive: 'Đang hoạt động',
  name: 'Tên',
  code: 'Mã',
  price: 'Giá',
  email: 'Email',
  username: 'Tên đăng nhập',
  displayName: 'Tên hiển thị',
  employmentStatusCode: 'Trạng thái làm việc',
  academicTitleCode: 'Học vị/Học hàm',
  positionCode: 'Chức danh',
  invoiceNo: 'Mã phiếu thu',
  totalAmount: 'Tổng tiền',
  section: 'Mục',
  sections: 'Các mục ghi chú',
  content: 'Nội dung',
  type: 'Loại',
  scheduledAt: 'Thời gian hẹn',
  durationMinutes: 'Thời lượng (phút)',
  bookingCode: 'Mã đặt lịch',
  encounterNo: 'Mã lượt khám',
  patientSourceCode: 'Nguồn khách hàng',
};

/**
 * Giá trị dạng mã (enum UPPER_SNAKE_CASE/viết hoa) xuất hiện trong nhiều entity khác nhau — dịch
 * theo GIÁ TRỊ (không phụ thuộc field key) vì cùng 1 mã có thể nằm ở field khác nhau tuỳ action.
 * Nhóm "mục ghi chú khám" lấy đúng nội dung `CLINICAL_SECTION_LABEL`
 * (`apps/web/src/features/encounter/clinical-display.tsx`) nhưng viết lại theo mã UPPER_SNAKE_CASE
 * thật sự lưu ở cột `clinical_note.section` (khác key camelCase của request body) — không import
 * chéo file đó để tránh phụ thuộc ngược giữa 2 feature, chỉ 6 dòng trùng lặp chấp nhận được.
 */
const KNOWN_VALUE_LABELS: Record<string, string> = {
  // clinical_note.section
  REASON_FOR_VISIT: 'Lý do khám',
  ILLNESS_PROGRESS: 'Quá trình bệnh lý',
  PRELIMINARY_DIAGNOSIS: 'Chẩn đoán',
  GENERAL_EXAM: 'Kết quả khám toàn thân',
  REGIONAL_EXAM: 'Kết quả khám bộ phận',
  PLAN: 'Kế hoạch',
  // diagnosis.type
  PRIMARY: 'Bệnh chính',
  SECONDARY: 'Bệnh kèm theo',
  // encounter.status
  SCHEDULED: 'Đã đặt lịch',
  CHECKED_IN: 'Đã tiếp nhận',
  IN_CONSULTATION: 'Đang khám',
  COMPLETED: 'Đã hoàn tất',
  CANCELLED: 'Đã huỷ',
  NO_SHOW: 'Không đến',
  CONVERTED: 'Đã chuyển khám',
  RESCHEDULED: 'Đã dời lịch',
  // invoice.status
  UNPAID: 'Chưa thu',
  PAID: 'Đã thu',
  REFUNDED: 'Đã hoàn tiền',
  // payment method mặc định
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
};

/** Field kỹ thuật/nội bộ — không có ý nghĩa nghiệp vụ, luôn ẩn khỏi màn hình xem chi tiết. */
const HIDDEN_FIELDS = new Set([
  'id',
  'tenantId',
  'version',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'deletedReason',
]);

export function labelForAuditField(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function isHiddenAuditField(field: string): boolean {
  return HIDDEN_FIELDS.has(field);
}

/**
 * Định dạng giá trị hiển thị (giá trị SCALAR — không phải mảng/object, xem `FieldTable` ở
 * `ActivityLogPage.tsx` cho phần đệ quy mảng/object lồng nhau) — boolean sang "Có"/"Không", số theo
 * `toLocaleString('vi-VN')`, chuỗi mã đã biết (`KNOWN_VALUE_LABELS`) dịch sang tiếng Việt, còn lại
 * nguyên văn.
 */
export function formatAuditFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'number') return value.toLocaleString('vi-VN');
  if (typeof value === 'string') return KNOWN_VALUE_LABELS[value] ?? value;
  return '';
}
