import { describe, expect, it } from 'vitest';
import { listPatientDocumentsQuerySchema, removePatientDocumentQuerySchema, uploadPatientDocumentFormSchema } from './patient-document';

describe('schema yêu cầu', () => {
  it('danh sách: limit mặc định 60, tối đa 100; folderId nhận UUID hoặc none', () => {
    expect(listPatientDocumentsQuerySchema.parse({}).limit).toBe(60);
    expect(listPatientDocumentsQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(listPatientDocumentsQuerySchema.safeParse({ folderId: 'none' }).success).toBe(true);
    expect(listPatientDocumentsQuerySchema.safeParse({ folderId: 'abc' }).success).toBe(false);
  });

  it('tải lên: chuỗi rỗng của trường tuỳ chọn coi như vắng; loại lạ bị từ chối', () => {
    expect(uploadPatientDocumentFormSchema.parse({ category: 'CONTRACT', folderId: '', note: '  ' })).toEqual({ category: 'CONTRACT' });
    expect(uploadPatientDocumentFormSchema.safeParse({ category: 'KHAC' }).success).toBe(false);
  });

  it('xoá: bắt buộc lý do và phiên bản', () => {
    expect(removePatientDocumentQuerySchema.safeParse({ version: '2' }).success).toBe(false);
    expect(removePatientDocumentQuerySchema.safeParse({ reason: 'x', version: '2' }).success).toBe(false);
    expect(removePatientDocumentQuerySchema.parse({ reason: 'Chụp nhầm', version: '2' })).toEqual({ reason: 'Chụp nhầm', version: 2 });
  });
});
