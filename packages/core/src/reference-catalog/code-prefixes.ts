import type { ReferenceCatalogCategory } from '@nexamed/shared';

/**
 * Tiền tố 2 ký tự cho mã tự sinh NGẮN, TUẦN TỰ (docs/DECISIONS.md #113, chủ dự án yêu cầu
 * 2026-09-03) — chỉ category KHÔNG có nguồn dữ liệu chính thức để nhập tay (mở rộng ADM-01
 * #063, "Đơn vị tính" #078, "Hình thức thanh toán" #084 — web ẩn hẳn ô "Mã" cho các category
 * này, xem `AUTO_CODE_CATEGORIES` ở `ReferenceCatalogPane.tsx`). Category KHÔNG có trong map này
 * (ETHNICITY/NATIONALITY/PATIENT_SOURCE/EXAM_TYPE/...) vẫn nhập mã tay như cũ, không đổi.
 *
 * Cố định tường minh theo từng category — KHÔNG cắt máy 2 ký tự đầu tên tiếng Anh như cơ chế cũ
 * (`generateReferenceCatalogCode`, đã lộ lỗi trùng tiền tố thật: EMPLOYMENT_STATUS/EMPLOYMENT_TYPE
 * cùng ra "EM"). Không trùng nhau trong toàn bộ mã tự sinh ngắn của hệ thống (các category này +
 * "ND"/"DN" của Nhóm dị nguyên/Dị nguyên + "CA" của Ca làm việc, xem allergen/code-prefixes.ts và
 * apps/api/src/modules/clinic/work-shift.service.ts).
 *
 * 9 category Kho Thuốc & Vật tư y tế (ACTIVE_INGREDIENT/DRUG_GROUP/DRUG_ROUTE/DOSAGE_FORM/
 * STORAGE_CONDITION/MANUFACTURER/COUNTRY_OF_ORIGIN/STORAGE_LOCATION/DRUG_USAGE_TIMING) được thêm
 * sau, ngày 18/09/2026 — GĐ1 (#146/#148) ra đời SAU #113 12 ngày nên bị bỏ sót lúc đó, mã tự
 * sinh của các mục do `clinic_admin` tự thêm (không phải mục seed sẵn từ nguồn BYT) vẫn dùng
 * định dạng cũ dài có gạch nối (`generateReferenceCatalogCode`, vd `AC-ECB97EF2`) cho tới hôm
 * nay. Chỉ áp dụng cho mục TẠO MỚI từ giờ — KHÔNG đánh số lại mã cũ đã tồn tại (chủ dự án chốt
 * qua AskUserQuestion, khác #113 — tránh cascade UPDATE rủi ro sang các cột đang lưu thẳng mã
 * này: drug.active_ingredient qua drug_ingredient, drug.drug_group_code/route_code/dosage_form/
 * storage_conditions/manufacturer_code/country_of_origin/storage_location, không đáng rủi ro vì
 * lợi ích chỉ là thẩm mỹ).
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
  // 9 category Kho Thuốc & Vật tư y tế (18/09/2026) — xem chú thích ở trên.
  ACTIVE_INGREDIENT: 'HC',
  DRUG_GROUP: 'NT',
  DRUG_ROUTE: 'DD',
  DOSAGE_FORM: 'DB',
  STORAGE_CONDITION: 'BQ',
  MANUFACTURER: 'HS',
  COUNTRY_OF_ORIGIN: 'QG',
  STORAGE_LOCATION: 'VT',
  DRUG_USAGE_TIMING: 'TD',
};
