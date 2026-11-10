import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { appendPdfDocuments, loadPdfDocuments } from './pdf-merge';

async function makePdf(pages: number, size: [number, number] = [595, 842]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage(size);
  return Buffer.from(await doc.save());
}

describe('pdf-merge', () => {
  it('loadPdfDocuments: mở được tệp hợp lệ, bỏ qua tệp hỏng và tệp không đọc được, giữ thứ tự khoá', async () => {
    const files = new Map<string, Buffer>([
      ['a', await makePdf(1)],
      ['hong', Buffer.from('%PDF-1.4\nkhông phải PDF thật\n%%EOF')],
      ['b', await makePdf(2)],
    ]);
    const loaded = await loadPdfDocuments(['a', 'hong', 'khong-co', 'b'], async (key) => {
      const bytes = files.get(key);
      if (!bytes) throw new Error('không có tệp');
      return bytes;
    });
    expect(loaded.map((l) => l.key)).toEqual(['a', 'b']);
    expect(loaded.map((l) => l.document.getPageCount())).toEqual([1, 2]);
  });

  it('appendPdfDocuments: nối trang của các tệp vào cuối theo thứ tự, giữ nguyên khổ trang gốc', async () => {
    const base = await makePdf(2); // A4
    const loaded = await loadPdfDocuments(['x', 'y'], async (key) => (key === 'x' ? makePdf(1, [300, 400]) : makePdf(2, [200, 200])));
    const merged = await appendPdfDocuments(base, loaded.map((l) => l.document));
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(5);
    const sizes = doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
    expect(sizes).toEqual([[595, 842], [595, 842], [300, 400], [200, 200], [200, 200]]);
  });

  it('appendPdfDocuments: không có tệp nào thì trả lại đúng bản gốc (không dựng lại)', async () => {
    const base = await makePdf(1);
    expect(await appendPdfDocuments(base, [])).toBe(base);
  });
});
