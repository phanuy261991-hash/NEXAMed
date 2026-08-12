import { describe, expect, it } from 'vitest';
import { sniffImageExtension } from './sniff-image-extension';

describe('sniffImageExtension (docs/DECISIONS.md #034) — magic byte, không tin Content-Type', () => {
  it('header JPEG đúng (FF D8 FF) → "jpg"', () => {
    expect(sniffImageExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe('jpg');
  });

  it('header PNG đúng (89 50 4E 47 0D 0A 1A 0A) → "png"', () => {
    expect(sniffImageExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]))).toBe('png');
  });

  it('nội dung văn bản thường (giả mạo đuôi .jpg) → null', () => {
    const bytes = new TextEncoder().encode('day khong phai la anh');
    expect(sniffImageExtension(bytes)).toBeNull();
  });

  it('buffer rỗng hoặc quá ngắn → null, không ném lỗi', () => {
    expect(sniffImageExtension(new Uint8Array([]))).toBeNull();
    expect(sniffImageExtension(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it('gần giống PNG nhưng sai 1 byte trong magic number → null', () => {
    expect(sniffImageExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x48, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
  });
});
