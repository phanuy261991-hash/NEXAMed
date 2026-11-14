import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PATIENT_DOCUMENT_CATEGORIES,
  PATIENT_DOCUMENT_CATEGORY_LABEL,
  PATIENT_DOCUMENT_DISPLAY_NAME_MAX,
  PATIENT_DOCUMENT_FOLDER_NAME_MAX,
  PATIENT_DOCUMENT_MAX_BYTES,
  PATIENT_DOCUMENT_NOTE_MAX,
  patientDocumentGroupOf,
} from '@nexamed/shared';

/**
 * `apps/web` chỉ được import KIỂU từ `@nexamed/shared` nên khai lại các hằng của tab "Hình ảnh & Tài liệu" ở `patient-document-constants.ts` (#299).
 * Test này nằm ở API (có kiểu Node + import được giá trị từ shared) để giữ hai bản không lệch nhau.
 */
describe('hằng của tab Hình ảnh & Tài liệu khớp giữa shared và web', () => {
  const webFile = readFileSync(resolve(__dirname, '../../../../web/src/features/patient-document/patient-document-constants.ts'), 'utf8');

  it('giới hạn số, danh sách loại và nhãn', () => {
    expect(webFile).toContain(`PATIENT_DOCUMENT_MAX_BYTES = ${PATIENT_DOCUMENT_MAX_BYTES / (1024 * 1024)} * 1024 * 1024`);
    expect(webFile).toContain(`PATIENT_DOCUMENT_FOLDER_NAME_MAX = ${PATIENT_DOCUMENT_FOLDER_NAME_MAX}`);
    expect(webFile).toContain(`PATIENT_DOCUMENT_DISPLAY_NAME_MAX = ${PATIENT_DOCUMENT_DISPLAY_NAME_MAX}`);
    expect(webFile).toContain(`PATIENT_DOCUMENT_NOTE_MAX = ${PATIENT_DOCUMENT_NOTE_MAX}`);
    for (const category of PATIENT_DOCUMENT_CATEGORIES) {
      expect(webFile).toContain(`'${category}'`);
      expect(webFile).toContain(PATIENT_DOCUMENT_CATEGORY_LABEL[category]);
    }
  });

  it('chỉ loại CONTRACT thuộc nhóm hợp đồng', () => {
    expect(PATIENT_DOCUMENT_CATEGORIES.filter((c) => patientDocumentGroupOf(c) === 'contract')).toEqual(['CONTRACT']);
    expect(webFile).toContain("category === 'CONTRACT' ? 'contract' : 'clinical'");
  });
});
