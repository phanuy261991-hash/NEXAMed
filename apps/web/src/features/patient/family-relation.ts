import type { FamilyRelation } from '@nexamed/shared';

/**
 * Tách RIÊNG khỏi `patient-form.utils.ts` (dù trùng `FAMILY_RELATION_LABELS` ở `packages/shared` —
 * lý do Rollup không dò được named export hằng số qua barrel, xem comment ở `patient-form.utils.ts`)
 * — module NÀY không import gì từ `PatientFormFields.tsx`/`patient-form.utils.ts`, để phá vòng lặp
 * import thật sự đã gây lỗi runtime: `PatientFormFields.tsx` → `PatientHistoryDialog.tsx` →
 * `patient-form.utils.ts` → `PatientFormFields.tsx`. Vite dev (native ESM, TDZ đúng chuẩn) chạy
 * theo thứ tự vòng này và ném `ReferenceError: Cannot access 'FAMILY_RELATION_LABELS' before
 * initialization` khi một module trong vòng đọc hằng số này ở top-level lúc chưa khởi tạo xong —
 * `vite build` (Rollup, tối ưu lại thứ tự module) không lộ lỗi này nên chỉ phát hiện được ở dev.
 * `PatientHistoryDialog.tsx` import trực tiếp từ ĐÂY (module lá, không nằm trong vòng lặp) thay vì
 * qua `patient-form.utils.ts`.
 */
export const FAMILY_RELATION_LABELS: Record<FamilyRelation, string> = {
  FATHER: 'Bố ruột',
  MOTHER: 'Mẹ ruột',
  SIBLING: 'Anh/Chị/Em ruột',
  PATERNAL_GRANDPARENT: 'Ông/Bà nội',
  MATERNAL_GRANDPARENT: 'Ông/Bà ngoại',
};
