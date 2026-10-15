import qrcode from 'qrcode-generator';

/** Mã QR dạng SVG (co giãn được, có viền trắng) cho địa chỉ `otpauth://` — không cần thư viện hình ảnh, nhúng thẳng vào trang. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}
