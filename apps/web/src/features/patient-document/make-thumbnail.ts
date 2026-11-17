/**
 * Ảnh thu nhỏ của tệp ảnh, tạo ở TRÌNH DUYỆT lúc tải lên (docs/DECISIONS.md #299 giai đoạn 3, mockup đã chốt): máy chủ không có thư viện xử lý ảnh, nên trình duyệt vẽ lại bằng canvas
 * thành JPEG nhỏ rồi gửi kèm tệp. Lưới "Theo ngày" và bảng tệp dùng ảnh này thay cho ảnh gốc (có thể vài MB). Chỉ dùng canvas + `createImageBitmap` — chạy được ở HTTP LAN
 * (không cần ngữ cảnh bảo mật). Ảnh thu nhỏ chỉ là phần thêm: tạo không được thì tệp vẫn tải lên bình thường và giao diện rơi về ảnh gốc.
 */

/** Cạnh dài tối đa của ảnh thu nhỏ: đủ nét cho ô 168 px trên màn hình độ phân giải cao. */
export const THUMBNAIL_MAX_SIDE = 320;
/** Chất lượng thử lần lượt từ cao xuống thấp cho tới khi vừa hạn mức. */
const THUMBNAIL_QUALITIES = [0.75, 0.6, 0.45];
/** Hạn mức máy chủ nhận (khớp `PATIENT_DOCUMENT_THUMBNAIL_MAX_BYTES` ở shared). */
export const THUMBNAIL_MAX_BYTES = 200 * 1024;
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];

/** Chỉ ảnh JPG/PNG có ảnh thu nhỏ; PDF và DICOM thì không. */
export function isThumbnailable(file: { name: string }): boolean {
  return IMAGE_EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() ?? '');
}

/** Kích thước ảnh thu nhỏ: giữ tỉ lệ, cạnh dài không quá `maxSide`, KHÔNG phóng to ảnh nhỏ. Thuần để kiểm bằng unit test. */
export function planThumbnailSize(width: number, height: number, maxSide = THUMBNAIL_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Vẽ nguồn ảnh (đã giải mã) thành JPEG thu nhỏ vừa hạn mức; `null` nếu không vẽ/mã hoá được hoặc thử hết vẫn quá lớn. */
async function encodeThumbnail(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): Promise<Blob | null> {
  const { width, height } = planThumbnailSize(sourceWidth, sourceHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  // JPEG không có nền trong suốt: tô trắng trước (ảnh PNG có vùng trong suốt).
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  for (const quality of THUMBNAIL_QUALITIES) {
    const blob = await toBlob(canvas, quality);
    if (blob && blob.size > 0 && blob.size <= THUMBNAIL_MAX_BYTES) return blob;
  }
  return null;
}

/** Tạo ảnh thu nhỏ JPEG từ tệp vừa chọn; trả `null` nếu không phải ảnh, trình duyệt không giải mã/vẽ được, hoặc thử hết vẫn quá hạn mức. */
export async function makeThumbnail(file: File): Promise<Blob | null> {
  if (!isThumbnailable(file)) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null; // ảnh hỏng hoặc định dạng trình duyệt không giải mã được: bỏ qua ảnh thu nhỏ, tệp vẫn tải lên bình thường
  }
  try {
    return await encodeThumbnail(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Tạo ảnh thu nhỏ từ ảnh ĐÃ tải xong trong trang (bù cho tệp cũ và dòng tự gộp — #299 bổ sung 5), khỏi tải lại ảnh gốc. Ảnh cùng nguồn gốc (nginx proxy `/api`) nên canvas không bị chặn;
 * nếu bị chặn (ảnh khác nguồn gốc) hoặc ảnh chưa giải mã xong thì trả `null`.
 */
export async function makeThumbnailFromImage(img: HTMLImageElement): Promise<Blob | null> {
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return null;
  try {
    return await encodeThumbnail(img, img.naturalWidth, img.naturalHeight);
  } catch {
    return null; // canvas bị chặn (SecurityError) hoặc trình duyệt không mã hoá được: bỏ qua, ô ảnh vẫn hiện ảnh gốc
  }
}
