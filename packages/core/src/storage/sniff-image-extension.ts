/**
 * Dò định dạng ảnh qua magic byte thật, không tin `Content-Type` client gửi — đúng yêu cầu
 * .claude/docs/security-audit.md mục "File upload" ("kiểm magic byte thay vì tin Content-Type").
 * Chỉ nhận diện jpg/png — đủ cho ảnh đại diện bệnh nhân (docs/DECISIONS.md #034); mở rộng thêm
 * định dạng khi có nhu cầu upload khác (đơn thuốc PDF, X-quang...).
 */
export function sniffImageExtension(buffer: Uint8Array): 'jpg' | 'png' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  return null;
}
