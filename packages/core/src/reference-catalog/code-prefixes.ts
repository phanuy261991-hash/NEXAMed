import type { ReferenceCatalogCategory } from '@nexamed/shared';

/**
 * Tiền tố 2 ký tự cho mã tự sinh NGẮN, TUẦN TỰ (docs/DECISIONS.md #113, chủ dự án yêu cầu
 * 2026-09-03) — chỉ 6 category KHÔNG có nguồn dữ liệu chính thức để nhập tay (mở rộng ADM-01
 * #063, "Đơn vị tính" #078, "Hình thức thanh toán" #084 — web ẩn hẳn ô "Mã" cho các category
 * này, xem `AUTO_CODE_CATEGORIES` ở `ReferenceCatalogPane.tsx`). Category KHÔNG có trong map này
 * (ETHNICITY/NATIONALITY/PATIENT_SOURCE/EXAM_TYPE/...) vẫn nhập mã tay như cũ, không đổi.
 *
 * Cố định tường minh theo từng category — KHÔNG cắt máy 2 ký tự đầu tên tiếng Anh như cơ chế cũ
 * (`generateReferenceCatalogCode`, đã lộ lỗi trùng tiền tố thật: EMPLOYMENT_STATUS/EMPLOYMENT_TYPE
 * cùng ra "EM"). Không trùng nhau trong toàn bộ 10 mã tự sinh ngắn của hệ thống (7 category này +
 * "ND"/"DN" của Nhóm dị nguyên/Dị nguyên + "CA" của Ca làm việc, xem allergen/code-prefixes.ts và
 * apps/api/src/modules/clinic/work-shift.service.ts).
 */
export const REFERENCE_CATALOG_SHORT_CODE_PREFIXES: Partial<Record<ReferenceCatalogCategory, string>> = {
  ACADEMIC_TITLE: 'HV',
  STAFF_POSITION: 'CD',
  EMPLOYMENT_STATUS: 'TT',
  EMPLOYMENT_TYPE: 'HL',
  UNIT: 'DV',
  PAYMENT_METHOD: 'TM',
  // Loại thu chi (2026-09-05) — chuẩn bị cho "Thu chi tại quầy"/Sổ quỹ, chưa xây (chỉ danh mục).
  INCOME_EXPENSE_TYPE: 'TC',
};
