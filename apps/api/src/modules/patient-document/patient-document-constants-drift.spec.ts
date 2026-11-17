import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PARACLINICAL_DICOM_MAX_BYTES,
  PARACLINICAL_DICOM_MAX_COUNT,
  PATIENT_DOCUMENT_CATEGORIES,
  PATIENT_DOCUMENT_CATEGORY_LABEL,
  PATIENT_DOCUMENT_DISPLAY_NAME_MAX,
  PATIENT_DOCUMENT_FOLDER_NAME_MAX,
  PATIENT_DOCUMENT_MAX_BYTES,
  PATIENT_DOCUMENT_NOTE_MAX,
  PATIENT_DOCUMENT_THUMBNAIL_MAX_BYTES,
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

  it('hạn mức ảnh thu nhỏ của trình duyệt khớp hạn mức máy chủ nhận', () => {
    const thumbFile = readFileSync(resolve(__dirname, '../../../../web/src/features/patient-document/make-thumbnail.ts'), 'utf8');
    expect(thumbFile).toContain(`THUMBNAIL_MAX_BYTES = ${PATIENT_DOCUMENT_THUMBNAIL_MAX_BYTES / 1024} * 1024`);
  });

  it('nginx của bản cài on-prem cho phép tải lên tệp lớn nhất (15 MB + ảnh thu nhỏ) vào tab tài liệu — trần 8m chung từng chặn 413 ở khách mà Vite proxy lúc phát triển không thấy', () => {
    const nginx = readFileSync(resolve(__dirname, '../../../../../deploy/on-prem/nginx.conf'), 'utf8');
    const match = /location ~ \^\/api\/v1\/patients\/\[\^\/\]\+\/documents\$ \{[^}]*client_max_body_size (\d+)m;/.exec(nginx);
    expect(match, 'thiếu khối location riêng cho đường dẫn tải tệp lên tab Hình ảnh & Tài liệu').not.toBeNull();
    const limitBytes = Number(match![1]) * 1024 * 1024;
    expect(limitBytes).toBeGreaterThanOrEqual(PATIENT_DOCUMENT_MAX_BYTES + PATIENT_DOCUMENT_THUMBNAIL_MAX_BYTES + 512 * 1024);
    // Trần chung của các đường dẫn khác không bị nới theo.
    expect(nginx).toMatch(/^\s{4}client_max_body_size 8m;/m);
  });

  it('nginx của bản cài on-prem cho phép tải tệp DICOM gốc lên kết quả chẩn đoán hình ảnh (50 MB + phần dư multipart) — đường dẫn khác vẫn 8m (#299 bổ sung 6)', () => {
    const nginx = readFileSync(resolve(__dirname, '../../../../../deploy/on-prem/nginx.conf'), 'utf8');
    const match = /location ~ \^\/api\/v1\/paraclinical\/imaging\/items\/\[\^\/\]\+\/dicom\$ \{[^}]*client_max_body_size (\d+)m;/.exec(nginx);
    expect(match, 'thiếu khối location riêng cho đường dẫn đính DICOM vào kết quả').not.toBeNull();
    expect(Number(match![1]) * 1024 * 1024).toBeGreaterThanOrEqual(PARACLINICAL_DICOM_MAX_BYTES + 512 * 1024);
    expect(nginx).toMatch(/^\s{4}client_max_body_size 8m;/m);
  });

  it('hạn mức tệp DICOM gốc của kết quả ở web khớp máy chủ (#299 bổ sung 6)', () => {
    const panel = readFileSync(resolve(__dirname, '../../../../web/src/features/paraclinical-result/ResultDicomPanel.tsx'), 'utf8');
    expect(panel).toContain(`PARACLINICAL_DICOM_MAX_COUNT = ${PARACLINICAL_DICOM_MAX_COUNT};`);
    expect(panel).toContain(`PARACLINICAL_DICOM_MAX_BYTES = ${PARACLINICAL_DICOM_MAX_BYTES / (1024 * 1024)} * 1024 * 1024;`);
  });

  it('chỉ loại CONTRACT thuộc nhóm hợp đồng', () => {
    expect(PATIENT_DOCUMENT_CATEGORIES.filter((c) => patientDocumentGroupOf(c) === 'contract')).toEqual(['CONTRACT']);
    expect(webFile).toContain("category === 'CONTRACT' ? 'contract' : 'clinical'");
  });
});
