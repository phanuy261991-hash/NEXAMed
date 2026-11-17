import * as dicomParser from 'dicom-parser';

/**
 * Đọc tệp DICOM ngay trong trình duyệt (docs/DECISIONS.md #299 bổ sung 6). Thư viện `dicom-parser` được đóng gói sẵn cùng bản web (chạy offline, ~32 KB), không tải gì từ Internet.
 * Hỗ trợ: dữ liệu điểm ảnh không nén (Little Endian, tường minh hoặc ngầm), đơn sắc 8/16 bit có hoặc không dấu (MONOCHROME1/2) và màu RGB (xen kẽ hoặc theo mặt phẳng), nhiều khung;
 * JPEG baseline/extended (ví dụ ảnh siêu âm) do chính trình duyệt giải mã. Kiểu nén khác (JPEG 2000, JPEG-LS, RLE...) → `unsupported` để giao diện đưa người dùng sang "Tải về".
 */

export class DicomDecodeError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'corrupt',
    message: string,
    /** Mã kiểu nén của tệp (khi `unsupported`), để nêu tên kiểu nén cho người dùng. */
    readonly transferSyntax?: string,
  ) {
    super(message);
    this.name = 'DicomDecodeError';
  }
}

const TS_IMPLICIT_LE = '1.2.840.10008.1.2';
const TS_EXPLICIT_LE = '1.2.840.10008.1.2.1';
const TS_JPEG_BASELINE = '1.2.840.10008.1.2.4.50';
const TS_JPEG_EXTENDED = '1.2.840.10008.1.2.4.51';

const COMPRESSION_LABELS: Record<string, string> = {
  '1.2.840.10008.1.2.4.90': 'JPEG 2000',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS',
  '1.2.840.10008.1.2.4.57': 'JPEG không mất dữ liệu',
  '1.2.840.10008.1.2.4.70': 'JPEG không mất dữ liệu',
  '1.2.840.10008.1.2.5': 'RLE',
  '1.2.840.10008.1.2.1.99': 'Deflate',
  '1.2.840.10008.1.2.2': 'Big Endian',
};

/** Tên dễ hiểu của kiểu nén (không lộ mã UID cho người dùng). */
export function compressionLabel(transferSyntax: string | undefined): string {
  return (transferSyntax && COMPRESSION_LABELS[transferSyntax]) || 'đặc biệt';
}

export type DicomPhotometric = 'MONOCHROME1' | 'MONOCHROME2' | 'RGB';

export interface DicomInfo {
  /** Tên bệnh nhân ghi trong tệp (đã đổi `^` thành khoảng trắng); rỗng nếu tệp không có. */
  patientName: string;
  patientId: string;
  patientAge: string;
  patientSex: string;
  modality: string;
  bodyPart: string;
  seriesDescription: string;
  /** Ngày chụp `dd/MM/yyyy` hoặc `null`. */
  studyDate: string | null;
  /** Giờ chụp `HH:mm` hoặc `null`. */
  studyTime: string | null;
  /** Kích thước điểm ảnh (mm), `null` nếu tệp không ghi. */
  pixelSpacingMm: number | null;
  rows: number;
  cols: number;
  frameCount: number;
}

export type DicomFrame = { kind: 'mono'; raw: Int8Array | Uint8Array | Int16Array | Uint16Array } | { kind: 'rgba'; rgba: Uint8ClampedArray; width: number; height: number };

export interface DicomImage {
  info: DicomInfo;
  photometric: DicomPhotometric;
  slope: number;
  intercept: number;
  /** Cửa sổ sáng/tương phản ghi sẵn trong tệp; `null` thì tính từ giá trị nhỏ nhất/lớn nhất của khung (xem `autoWindow`). */
  tagWindow: { center: number; width: number } | null;
  getFrame(index: number): Promise<DicomFrame>;
}

function text(ds: dicomParser.DataSet, tag: string): string {
  return (ds.string(tag) ?? '').trim();
}

/** `NGUYEN^VAN^AN` → `NGUYEN VAN AN` (chỉ lấy nhóm đầu nếu có nhiều nhóm ký tự). */
export function dicomPersonName(raw: string): string {
  return raw.split('=')[0]!.split('^').map((p) => p.trim()).filter(Boolean).join(' ');
}

function formatDate(raw: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.replace(/\D/g, '').slice(0, 8));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function formatTime(raw: string): string | null {
  const m = /^(\d{2})(\d{2})/.exec(raw.replace(/[^\d]/g, ''));
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Bỏ dấu, viết hoa, tách theo ký tự không phải chữ — để so tên trong tệp (không dấu, in hoa) với tên trong hồ sơ. */
export function nameTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/** Tên trong tệp có khớp tên trong hồ sơ không (không phân biệt dấu, hoa/thường, thứ tự từ). Tệp không ghi tên thì coi như khớp (không có gì để đối chiếu). */
export function dicomNameMatches(fileName: string, recordName: string): boolean {
  const a = nameTokens(fileName);
  const b = nameTokens(recordName);
  if (a.length === 0 || b.length === 0) return true;
  return a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');
}

/**
 * Đọc đầu tệp DICOM và dựng bộ giải mã từng khung. Ném `DicomDecodeError`: `corrupt` (không phải DICOM/hỏng/thiếu dữ liệu ảnh) hoặc `unsupported` (kiểu nén chưa đọc được).
 */
export function openDicom(bytes: Uint8Array): DicomImage {
  // Đọc riêng phần đầu (meta) để biết kiểu nén TRƯỚC khi dựng cả bộ dữ liệu: tệp nén chưa hỗ trợ báo rõ "chưa đọc được kiểu nén" thay vì lỗi tệp hỏng, và khỏi đọc tệp lớn vô ích.
  let transferSyntax: string;
  try {
    transferSyntax = (dicomParser.readPart10Header(bytes).string('x00020010') ?? TS_IMPLICIT_LE).trim();
  } catch {
    throw new DicomDecodeError('corrupt', 'Không đọc được nội dung tệp.');
  }
  const native = transferSyntax === TS_IMPLICIT_LE || transferSyntax === TS_EXPLICIT_LE;
  const jpeg = transferSyntax === TS_JPEG_BASELINE || transferSyntax === TS_JPEG_EXTENDED;
  if (!native && !jpeg) throw new DicomDecodeError('unsupported', `Kiểu nén ${compressionLabel(transferSyntax)} chưa đọc được.`, transferSyntax);

  let ds: dicomParser.DataSet;
  try {
    ds = dicomParser.parseDicom(bytes);
  } catch {
    throw new DicomDecodeError('corrupt', 'Không đọc được nội dung tệp.');
  }

  const rowsTag = ds.uint16('x00280010');
  const colsTag = ds.uint16('x00280011');
  if (!rowsTag || !colsTag) throw new DicomDecodeError('corrupt', 'Tệp thiếu kích thước ảnh.');
  const rows: number = rowsTag;
  const cols: number = colsTag;
  const pixelEl = ds.elements.x7fe00010;
  if (!pixelEl) throw new DicomDecodeError('corrupt', 'Tệp không có dữ liệu ảnh.');
  const frameCount = Math.max(1, Number.parseInt(text(ds, 'x00280008'), 10) || 1);
  const samples = ds.uint16('x00280002') ?? 1;
  const bitsAllocated = ds.uint16('x00280100') ?? 16;
  const signed = (ds.uint16('x00280103') ?? 0) === 1;
  const planar = (ds.uint16('x00280006') ?? 0) === 1;
  const photometricRaw = text(ds, 'x00280004') || 'MONOCHROME2';

  let photometric: DicomPhotometric;
  if (photometricRaw === 'MONOCHROME1' || photometricRaw === 'MONOCHROME2') photometric = photometricRaw;
  else if (photometricRaw === 'RGB' || jpeg) photometric = 'RGB';
  else throw new DicomDecodeError('unsupported', 'Kiểu màu của ảnh chưa đọc được.', transferSyntax);
  if (native && (samples !== 1 && samples !== 3)) throw new DicomDecodeError('unsupported', 'Số kênh màu chưa đọc được.', transferSyntax);
  if (native && bitsAllocated !== 8 && bitsAllocated !== 16) throw new DicomDecodeError('unsupported', 'Độ sâu điểm ảnh chưa đọc được.', transferSyntax);

  const slope = ds.floatString('x00281053') ?? 1;
  const intercept = ds.floatString('x00281052') ?? 0;
  const wc = ds.floatString('x00281050', 0);
  const ww = ds.floatString('x00281051', 0);
  const tagWindow = wc !== undefined && ww !== undefined && ww > 0 ? { center: wc, width: ww } : null;

  const spacing = ds.floatString('x00280030', 0) ?? ds.floatString('x00181164', 0);
  const info: DicomInfo = {
    patientName: dicomPersonName(text(ds, 'x00100010')),
    patientId: text(ds, 'x00100020'),
    patientAge: text(ds, 'x00101010'),
    patientSex: text(ds, 'x00100040'),
    modality: text(ds, 'x00080060'),
    bodyPart: text(ds, 'x00180015'),
    seriesDescription: text(ds, 'x0008103e'),
    studyDate: formatDate(text(ds, 'x00080020')),
    studyTime: formatTime(text(ds, 'x00080030')),
    pixelSpacingMm: spacing !== undefined && spacing > 0 ? spacing : null,
    rows,
    cols,
    frameCount,
  };

  const bytesPerSample = bitsAllocated / 8;
  const frameBytes = rows * cols * samples * bytesPerSample;
  let offsetTable: number[] | null = null;

  async function getFrame(index: number): Promise<DicomFrame> {
    if (index < 0 || index >= frameCount) throw new DicomDecodeError('corrupt', 'Khung không tồn tại.');
    if (jpeg) {
      let data: Uint8Array;
      try {
        if (frameCount === 1) data = dicomParser.readEncapsulatedPixelData(ds, pixelEl!, 0);
        else {
          offsetTable ??= pixelEl!.basicOffsetTable?.length ? pixelEl!.basicOffsetTable : dicomParser.createJPEGBasicOffsetTable(ds, pixelEl!);
          data = dicomParser.readEncapsulatedImageFrame(ds, pixelEl!, index, offsetTable);
        }
      } catch {
        throw new DicomDecodeError('corrupt', 'Không đọc được khung ảnh.');
      }
      return decodeJpegFrame(data);
    }
    const start = pixelEl!.dataOffset + index * frameBytes;
    if (start + frameBytes > bytes.length) throw new DicomDecodeError('corrupt', 'Tệp thiếu dữ liệu ảnh.');
    const slice = bytes.slice(start, start + frameBytes);
    if (samples === 1) {
      if (bitsAllocated === 8) return { kind: 'mono', raw: signed ? new Int8Array(slice.buffer) : slice };
      return { kind: 'mono', raw: signed ? new Int16Array(slice.buffer) : new Uint16Array(slice.buffer) };
    }
    return { kind: 'rgba', rgba: toRgba(slice, rows * cols, bitsAllocated, planar), width: cols, height: rows };
  }

  return { info, photometric, slope, intercept, tagWindow, getFrame };
}

/** RGB 8/16 bit (xen kẽ RGBRGB hoặc theo mặt phẳng RRR…GGG…BBB…) → RGBA 8 bit. Ảnh 16 bit/kênh lấy byte cao. */
function toRgba(src: Uint8Array, pixels: number, bitsAllocated: number, planar: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels * 4);
  const step = bitsAllocated === 16 ? 2 : 1;
  const hi = bitsAllocated === 16 ? 1 : 0;
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) {
      const sample = planar ? c * pixels + i : i * 3 + c;
      out[i * 4 + c] = src[sample * step + hi]!;
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

async function decodeJpegFrame(data: Uint8Array): Promise<DicomFrame> {
  if (typeof createImageBitmap !== 'function') throw new DicomDecodeError('unsupported', 'Trình duyệt không giải mã được ảnh JPEG trong tệp.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/jpeg' }));
  } catch {
    throw new DicomDecodeError('corrupt', 'Không giải mã được khung ảnh JPEG.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new DicomDecodeError('unsupported', 'Trình duyệt không vẽ được ảnh.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { kind: 'rgba', rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

/** Cửa sổ tự động của một khung đơn sắc: từ giá trị nhỏ nhất đến lớn nhất (sau khi đổi theo slope/intercept). */
export function autoWindow(raw: ArrayLike<number>, slope: number, intercept: number): { center: number; width: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]! * slope + intercept;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { center: 128, width: 256 };
  const width = Math.max(1, hi - lo);
  return { center: lo + width / 2, width };
}

/** Số khoảng nhảy để ảnh rất lớn được thu nhỏ khi vẽ (không quá `maxPixels` điểm ảnh) — máy yếu không bị đứng; bản tải về vẫn là bản gốc. */
export function viewStride(rows: number, cols: number, maxPixels = 8_000_000): number {
  return Math.max(1, Math.ceil(Math.sqrt((rows * cols) / maxPixels)));
}

/**
 * Vẽ khung đơn sắc ra RGBA 8 bit theo cửa sổ [center ± width/2]. `invert` đảo trắng đen (đã gồm MONOCHROME1). Trả về kích thước ảnh sau khi thu nhỏ theo `stride`.
 */
export function bakeMono(
  raw: ArrayLike<number>,
  rows: number,
  cols: number,
  opts: { slope: number; intercept: number; center: number; width: number; invert: boolean; stride: number },
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const { slope, intercept, center, width, invert, stride } = opts;
  const outW = Math.ceil(cols / stride);
  const outH = Math.ceil(rows / stride);
  const rgba = new Uint8ClampedArray(outW * outH * 4);
  const w = Math.max(width, 1e-6);
  const lo = center - w / 2;
  let o = 0;
  for (let y = 0; y < rows; y += stride) {
    for (let x = 0; x < cols; x += stride) {
      const v = raw[y * cols + x]! * slope + intercept;
      let g = ((v - lo) / w) * 255;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      if (invert) g = 255 - g;
      rgba[o++] = g;
      rgba[o++] = g;
      rgba[o++] = g;
      rgba[o++] = 255;
    }
  }
  return { rgba, width: outW, height: outH };
}
