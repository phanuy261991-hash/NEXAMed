import { describe, expect, it } from 'vitest';
import type { PatientDocument, PatientDocumentAccess } from '@nexamed/shared';
import {
  canDeleteDocument,
  canEditDocument,
  canOpenResult,
  formatBytes,
  formatIsoDateVi,
  groupByUploadDate,
  sourceBadge,
  sourceText,
  suggestCategory,
  uploadableCategories,
  validateFileForUpload,
} from './patient-document-view';

const MB = 1024 * 1024;
const doc = (over: Partial<PatientDocument>): PatientDocument => ({
  id: 'a',
  patientId: 'p',
  category: 'CLINICAL_PHOTO',
  source: 'UPLOAD',
  readOnly: false,
  sourceLabel: null,
  sourceRef: null,
  fileName: 'a.jpg',
  displayName: 'a.jpg',
  contentType: 'image/jpeg',
  kind: 'image',
  sizeBytes: 100,
  note: null,
  folderId: null,
  folderName: null,
  encounterId: null,
  encounterLabel: null,
  uploadedAt: '2026-11-13T02:00:00.000Z',
  uploadDate: '2026-11-13',
  uploadedByName: 'x',
  branchId: 'b',
  branchName: null,
  url: '/u',
  version: 1,
  ...over,
});

const access = (clinical: boolean, contract: boolean): PatientDocumentAccess => ({
  clinical: { read: clinical, upload: clinical, delete: clinical },
  contract: { read: contract, upload: contract, delete: contract },
});

describe('formatBytes / formatIsoDateVi', () => {
  it('định dạng dung lượng theo chuẩn Việt (dấu phẩy thập phân)', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(2.1 * MB)).toBe('2,1 MB');
    expect(formatIsoDateVi('2026-11-13')).toBe('13/11/2026');
  });
});

describe('groupByUploadDate', () => {
  it('gom theo ngày tải, giữ thứ tự và cộng dung lượng', () => {
    const groups = groupByUploadDate([
      doc({ id: '1', sizeBytes: 10 }),
      doc({ id: '2', sizeBytes: 20 }),
      doc({ id: '3', uploadDate: '2026-11-02', sizeBytes: 5 }),
    ]);
    expect(groups.map((g) => [g.date, g.items.length, g.totalBytes])).toEqual([
      ['2026-11-13', 2, 30],
      ['2026-11-02', 1, 5],
    ]);
  });
});

describe('nhãn nguồn', () => {
  it('chỉ tệp tham chiếu mới có nhãn ở góc ảnh', () => {
    expect(sourceBadge('UPLOAD')).toBeNull();
    expect(sourceBadge('PARACLINICAL_IMAGE')).toBe('Từ kết quả CLS');
    expect(sourceBadge('INSURANCE_CARD')).toBe('Từ thẻ BHYT');
    expect(sourceText({ source: 'UPLOAD', category: 'CONTRACT', sourceLabel: null })).toBe('Tải lên tay · Hợp đồng và giấy tờ');
  });

  it('cột Nguồn của dòng tham chiếu theo mockup: Kết quả CLS · tên dịch vụ, Từ thẻ BHYT, Từ hồ sơ', () => {
    expect(sourceText({ source: 'PARACLINICAL_IMAGE', category: 'PARACLINICAL', sourceLabel: 'Siêu âm ổ bụng' })).toBe('Kết quả CLS · Siêu âm ổ bụng');
    expect(sourceText({ source: 'PARACLINICAL_IMAGE', category: 'PARACLINICAL', sourceLabel: null })).toBe('Kết quả CLS');
    expect(sourceText({ source: 'INSURANCE_CARD', category: 'CONTRACT', sourceLabel: null })).toBe('Từ thẻ BHYT');
    expect(sourceText({ source: 'PATIENT_PHOTO', category: 'OTHER', sourceLabel: null })).toBe('Từ hồ sơ');
  });

  it('chỉ dòng có tham chiếu kết quả mới mở được phiếu kết quả', () => {
    expect(canOpenResult({ sourceRef: { orderItemId: 'i', encounterId: 'e', group: 'imaging' } })).toBe(true);
    expect(canOpenResult({ sourceRef: null })).toBe(false);
  });
});

describe('quyền theo nhóm', () => {
  it('lễ tân chỉ tải được hợp đồng; tệp tham chiếu không sửa/xoá được', () => {
    const reception = access(false, true);
    expect(uploadableCategories(reception, ['PARACLINICAL', 'CLINICAL_PHOTO', 'CONTRACT', 'OTHER'])).toEqual(['CONTRACT']);
    expect(canEditDocument(doc({ category: 'CONTRACT' }), reception)).toBe(true);
    expect(canEditDocument(doc({ category: 'CLINICAL_PHOTO' }), reception)).toBe(false);
    expect(canDeleteDocument(doc({ readOnly: true, category: 'CONTRACT' }), reception)).toBe(false);
  });
});

describe('validateFileForUpload', () => {
  it('từ chối sai đuôi, tệp rỗng và tệp quá lớn; câu lỗi nêu dung lượng thật', () => {
    expect(validateFileForUpload({ name: 'a.jpg', size: 10 }, 15 * MB)).toBeNull();
    expect(validateFileForUpload({ name: 'virus.exe', size: 10 }, 15 * MB)).toMatch(/Chỉ nhận/);
    expect(validateFileForUpload({ name: 'a.jpg', size: 0 }, 15 * MB)).toMatch(/rỗng/);
    expect(validateFileForUpload({ name: 'a.jpg', size: 21 * MB }, 15 * MB)).toBe('Tệp 21,0 MB vượt quá 15 MB, chọn tệp nhỏ hơn');
  });
});

describe('suggestCategory', () => {
  it('ảnh → Ảnh lâm sàng, còn lại → Khác; thiếu quyền thì rơi về loại được phép', () => {
    expect(suggestCategory('a.jpg', ['CLINICAL_PHOTO', 'OTHER'])).toBe('CLINICAL_PHOTO');
    expect(suggestCategory('a.pdf', ['CLINICAL_PHOTO', 'OTHER'])).toBe('OTHER');
    expect(suggestCategory('a.pdf', ['CONTRACT'])).toBe('CONTRACT');
    expect(suggestCategory('a.pdf', [])).toBeNull();
  });
});
