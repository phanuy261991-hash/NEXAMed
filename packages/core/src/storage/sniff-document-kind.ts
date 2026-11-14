import { sniffImageExtension } from './sniff-image-extension';

/** Loại tệp nhận cho "Hình ảnh & Tài liệu" của bệnh nhân (docs/DECISIONS.md #299): ảnh JPG/PNG, PDF, DICOM. */
export type DocumentKind = 'jpg' | 'png' | 'pdf' | 'dcm';

/**
 * Nhận diện loại tệp bằng magic byte (KHÔNG tin `Content-Type` hay đuôi tên tệp do client gửi — .claude/docs/security-audit.md mục "File upload").
 * PDF bắt đầu bằng `%PDF-`; DICOM có 128 byte đầu tự do rồi đến `DICM`. Trả `null` nếu không phải loại nào được nhận.
 */
export function sniffDocumentKind(buffer: Uint8Array): DocumentKind | null {
  const image = sniffImageExtension(buffer);
  if (image) return image;
  if (buffer.length >= 5 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 && buffer[4] === 0x2d) {
    return 'pdf';
  }
  if (buffer.length >= 132 && buffer[128] === 0x44 && buffer[129] === 0x49 && buffer[130] === 0x43 && buffer[131] === 0x4d) {
    return 'dcm';
  }
  return null;
}

export const DOCUMENT_CONTENT_TYPE: Record<DocumentKind, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  dcm: 'application/dicom',
};
