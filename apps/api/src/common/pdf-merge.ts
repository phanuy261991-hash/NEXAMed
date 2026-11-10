import { PDFDocument } from 'pdf-lib';

/** Tệp PDF đọc được (đã mở bằng pdf-lib) kèm khoá để đối chiếu với kết quả; không đọc được (hỏng, bị mã hoá) thì KHÔNG có trong kết quả. */
export interface LoadedPdf {
  key: string;
  document: PDFDocument;
}

/**
 * Mở các tệp PDF theo khoá. Tệp hỏng, không có trang nào hoặc có mật khẩu bị bỏ qua (không làm hỏng cả lần xuất) — nơi gọi so sánh số tệp mở được với số tệp cần ghép để báo trong bản in.
 * `read` do nơi gọi truyền vào (đọc qua `StoragePort`) nên hàm này không biết gì về nơi lưu tệp.
 */
export async function loadPdfDocuments(keys: readonly string[], read: (key: string) => Promise<Uint8Array>): Promise<LoadedPdf[]> {
  const loaded: LoadedPdf[] = [];
  for (const key of keys) {
    try {
      const document = await PDFDocument.load(await read(key), { ignoreEncryption: false, updateMetadata: false });
      // pdf-lib đọc khoan dung: tệp hỏng có thể mở được thành tài liệu RỖNG — không có trang nào thì coi như không đọc được.
      if (document.getPageCount() > 0) loaded.push({ key, document });
    } catch {
      // Bỏ qua tệp không đọc được; nơi gọi tự phát hiện qua số tệp mở được.
    }
  }
  return loaded;
}

/** Nối tất cả các trang của `extras` vào cuối `base` theo thứ tự đã cho, giữ nguyên nội dung gốc của từng tệp. Không có tệp nào thì trả lại đúng `base`. */
export async function appendPdfDocuments(base: Buffer, extras: readonly PDFDocument[]): Promise<Buffer> {
  if (extras.length === 0) return base;
  const target = await PDFDocument.load(base, { updateMetadata: false });
  for (const extra of extras) {
    const pages = await target.copyPages(extra, extra.getPageIndices());
    for (const page of pages) target.addPage(page);
  }
  return Buffer.from(await target.save());
}
