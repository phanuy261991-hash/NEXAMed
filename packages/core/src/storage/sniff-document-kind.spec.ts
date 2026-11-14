import { describe, expect, it } from 'vitest';
import { sniffDocumentKind } from './sniff-document-kind';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('sniffDocumentKind', () => {
  it('nhận JPG và PNG qua magic byte', () => {
    expect(sniffDocumentKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpg');
    expect(sniffDocumentKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
  });

  it('nhận PDF khi bắt đầu bằng %PDF-', () => {
    expect(sniffDocumentKind(new TextEncoder().encode('%PDF-1.7\n...'))).toBe('pdf');
  });

  it('không nhận chuỗi giống PDF nhưng không ở đầu tệp', () => {
    expect(sniffDocumentKind(new TextEncoder().encode(' %PDF-1.7'))).toBeNull();
  });

  it('nhận DICOM khi có DICM ở byte 128', () => {
    const buf = new Uint8Array(140);
    buf.set([0x44, 0x49, 0x43, 0x4d], 128);
    expect(sniffDocumentKind(buf)).toBe('dcm');
  });

  it('từ chối DICOM thiếu DICM, tệp rỗng và tệp thực thi đổi đuôi', () => {
    expect(sniffDocumentKind(new Uint8Array(140))).toBeNull();
    expect(sniffDocumentKind(new Uint8Array(0))).toBeNull();
    expect(sniffDocumentKind(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
  });
});
