/**
 * Thu nhỏ ảnh quá lớn ở TRÌNH DUYỆT trước khi tải lên (docs/DECISIONS.md #299, chủ dự án chốt 14/11/2026): ảnh JPG/PNG vượt giới hạn dung lượng được vẽ lại
 * bằng canvas và lưu JPEG; tệp khác (PDF, DICOM) vượt giới hạn vẫn báo lỗi. Chỉ dùng canvas + `createImageBitmap` (chạy được ở HTTP LAN, không cần ngữ cảnh bảo mật).
 */

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];
/** Cạnh dài tối đa lần thử đầu: đủ nét cho phim/ảnh lâm sàng mà vẫn nhỏ. */
const MAX_SIDE = 4096;
/** Chừa biên so với giới hạn để lần tải không sát ngưỡng. */
const TARGET_RATIO = 0.9;

export interface ShrinkAttempt {
  width: number;
  height: number;
  quality: number;
}

/** Ảnh JPG/PNG vượt giới hạn → thu nhỏ được; ngược lại (đúng cỡ, hoặc không phải ảnh) thì không. */
export function isShrinkableImage(file: { name: string; size: number }, maxBytes: number): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.includes(ext) && file.size > maxBytes;
}

/** Dãy lần thử từ nhẹ đến mạnh: giảm chất lượng trước, rồi giảm kích thước (×0,8 mỗi vòng). Thuần để kiểm bằng unit test. */
export function planShrinkAttempts(width: number, height: number): ShrinkAttempt[] {
  const cap = Math.min(1, MAX_SIDE / Math.max(width, height));
  const attempts: ShrinkAttempt[] = [];
  let scale = cap;
  for (let round = 0; round < 5; round++) {
    for (const quality of [0.85, 0.7]) {
      attempts.push({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality });
    }
    scale *= 0.8;
  }
  return attempts;
}

/** Tên tệp sau khi chuyển sang JPEG: giữ phần tên, đổi đuôi. */
export function shrunkFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Thu nhỏ ảnh tới khi vừa giới hạn. Ném lỗi nếu trình duyệt không giải mã được ảnh hoặc thử hết mà vẫn quá lớn. */
export async function shrinkImageToLimit(file: File, maxBytes: number): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const attempt of planShrinkAttempts(bitmap.width, bitmap.height)) {
      const canvas = document.createElement('canvas');
      canvas.width = attempt.width;
      canvas.height = attempt.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas-unavailable');
      // JPEG không có nền trong suốt: tô trắng trước (ảnh PNG có vùng trong suốt).
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, attempt.width, attempt.height);
      context.drawImage(bitmap, 0, 0, attempt.width, attempt.height);
      const blob = await toBlob(canvas, attempt.quality);
      if (blob && blob.size <= maxBytes * TARGET_RATIO) {
        return new File([blob], shrunkFileName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error('still-too-large');
}
