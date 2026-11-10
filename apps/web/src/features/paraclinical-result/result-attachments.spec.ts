import { describe, expect, it } from 'vitest';
import { isPdfAttachment, splitAttachments } from './result-attachments';

const item = (id: string, contentType: string) => ({ id, fileName: `${id}.x`, url: `/api/v1/files/${id}`, contentType });

describe('result-attachments', () => {
  it('nhận ra PDF không phân biệt hoa thường', () => {
    expect(isPdfAttachment(item('a', 'application/pdf'))).toBe(true);
    expect(isPdfAttachment(item('b', 'Application/PDF'))).toBe(true);
    expect(isPdfAttachment(item('c', 'image/png'))).toBe(false);
  });

  it('tách ảnh và PDF, giữ thứ tự', () => {
    const { images, pdfs } = splitAttachments([item('1', 'image/jpeg'), item('2', 'application/pdf'), item('3', 'image/png')]);
    expect(images.map((i) => i.id)).toEqual(['1', '3']);
    expect(pdfs.map((i) => i.id)).toEqual(['2']);
  });
});
