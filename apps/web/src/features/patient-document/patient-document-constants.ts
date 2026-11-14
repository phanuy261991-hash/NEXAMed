import type { PatientDocumentCategory } from '@nexamed/shared';

/**
 * Hằng của tab "Hình ảnh & Tài liệu" phía web: `apps/web` chỉ được import KIỂU từ `@nexamed/shared` (bản dist là CommonJS), nên giá trị khai lại ở đây.
 * Nguồn sự thật nằm ở `packages/shared/src/patient-document.ts`; `patient-document-constants.spec.ts` kiểm hai bên không lệch nhau.
 */
export const PATIENT_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
export const PATIENT_DOCUMENT_FOLDER_NAME_MAX = 60;
export const PATIENT_DOCUMENT_DISPLAY_NAME_MAX = 200;
export const PATIENT_DOCUMENT_NOTE_MAX = 1000;

export const PATIENT_DOCUMENT_CATEGORIES: readonly PatientDocumentCategory[] = ['PARACLINICAL', 'CLINICAL_PHOTO', 'CONTRACT', 'OTHER'];

export const PATIENT_DOCUMENT_CATEGORY_LABEL: Record<PatientDocumentCategory, string> = {
  PARACLINICAL: 'Kết quả cận lâm sàng',
  CLINICAL_PHOTO: 'Ảnh lâm sàng',
  CONTRACT: 'Hợp đồng và giấy tờ',
  OTHER: 'Khác',
};

/** Hai nhóm quyền độc lập: tệp LÂM SÀNG (`patient_document.*`) và HỢP ĐỒNG VÀ GIẤY TỜ (`patient_contract.*`). */
export type PatientDocumentGroup = 'clinical' | 'contract';
export function patientDocumentGroupOf(category: PatientDocumentCategory): PatientDocumentGroup {
  return category === 'CONTRACT' ? 'contract' : 'clinical';
}
