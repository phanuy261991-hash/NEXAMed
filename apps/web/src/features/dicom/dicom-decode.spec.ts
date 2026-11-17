import { describe, expect, it } from 'vitest';
import { autoWindow, bakeMono, compressionLabel, DicomDecodeError, dicomNameMatches, dicomPersonName, nameTokens, openDicom, viewStride } from './dicom-decode';
import { buildDicom } from './dicom-test-builder';

describe('openDicom', () => {
  it('đọc ảnh X-quang 16 bit không nén: kích thước, thông tin bệnh nhân/ngày chụp/khoảng cách điểm ảnh và giá trị điểm ảnh', async () => {
    const pixels = Uint16Array.from([0, 100, 200, 300, 400, 500]);
    const file = buildDicom({
      rows: 2,
      cols: 3,
      bitsAllocated: 16,
      pixels,
      patientName: 'NGUYEN^VAN^AN',
      patientId: 'BN-001',
      modality: 'CR',
      studyDate: '20261117',
      studyTime: '084100',
      pixelSpacing: '0.143\\0.143',
      windowCenter: '250',
      windowWidth: '500',
    });
    const dicom = openDicom(file);
    expect(dicom.info).toMatchObject({ patientName: 'NGUYEN VAN AN', patientId: 'BN-001', modality: 'CR', studyDate: '17/11/2026', studyTime: '08:41', pixelSpacingMm: 0.143, rows: 2, cols: 3, frameCount: 1 });
    expect(dicom.photometric).toBe('MONOCHROME2');
    expect(dicom.tagWindow).toEqual({ center: 250, width: 500 });
    const frame = await dicom.getFrame(0);
    expect(frame.kind).toBe('mono');
    expect(Array.from((frame as { raw: Uint16Array }).raw)).toEqual([0, 100, 200, 300, 400, 500]);
  });

  it('nhiều khung: mỗi khung có dữ liệu riêng; số khung ngoài phạm vi bị từ chối', async () => {
    const file = buildDicom({ rows: 1, cols: 2, bitsAllocated: 8, pixels: Uint8Array.from([1, 2, 3, 4, 5, 6]), frames: 3 });
    const dicom = openDicom(file);
    expect(dicom.info.frameCount).toBe(3);
    expect(Array.from(((await dicom.getFrame(2)) as { raw: Uint8Array }).raw)).toEqual([5, 6]);
    await expect(dicom.getFrame(3)).rejects.toBeInstanceOf(DicomDecodeError);
  });

  it('16 bit có dấu + slope/intercept (CT): giá trị đổi đúng, cửa sổ tự động theo dữ liệu khi tệp không ghi', async () => {
    const file = buildDicom({ rows: 1, cols: 3, bitsAllocated: 16, signed: true, pixels: Int16Array.from([0, 1000, 2000]), slope: '1', intercept: '-1024' });
    const dicom = openDicom(file);
    expect(dicom.slope).toBe(1);
    expect(dicom.intercept).toBe(-1024);
    expect(dicom.tagWindow).toBeNull();
    const frame = (await dicom.getFrame(0)) as { raw: Int16Array };
    expect(autoWindow(frame.raw, dicom.slope, dicom.intercept)).toEqual({ center: -24, width: 2000 });
  });

  it('ảnh màu RGB (xen kẽ và theo mặt phẳng) → RGBA', async () => {
    const interleaved = openDicom(buildDicom({ rows: 1, cols: 2, bitsAllocated: 8, samples: 3, photometric: 'RGB', pixels: Uint8Array.from([255, 0, 0, 0, 255, 0]) }));
    expect(Array.from(((await interleaved.getFrame(0)) as { rgba: Uint8ClampedArray }).rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    const planar = openDicom(buildDicom({ rows: 1, cols: 2, bitsAllocated: 8, samples: 3, photometric: 'RGB', planar: true, pixels: Uint8Array.from([255, 0, 0, 255, 0, 0]) }));
    expect(Array.from(((await planar.getFrame(0)) as { rgba: Uint8ClampedArray }).rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('kiểu nén chưa hỗ trợ (JPEG 2000, RLE, Big Endian) → unsupported kèm tên kiểu nén; không nêu mã UID', () => {
    for (const [uid, label] of [
      ['1.2.840.10008.1.2.4.90', 'JPEG 2000'],
      ['1.2.840.10008.1.2.5', 'RLE'],
      ['1.2.840.10008.1.2.2', 'Big Endian'],
    ] as const) {
      const file = buildDicom({ rows: 1, cols: 1, bitsAllocated: 8, pixels: Uint8Array.from([1]), transferSyntax: uid });
      try {
        openDicom(file);
        throw new Error('phải ném lỗi');
      } catch (err) {
        expect(err).toBeInstanceOf(DicomDecodeError);
        expect((err as DicomDecodeError).reason).toBe('unsupported');
        expect(compressionLabel((err as DicomDecodeError).transferSyntax)).toBe(label);
        expect((err as DicomDecodeError).message).not.toMatch(/\d+\.\d+\.\d+/);
      }
    }
  });

  it('tệp hỏng: không phải DICOM, thiếu dữ liệu ảnh, cắt ngang → corrupt', () => {
    expect(() => openDicom(new Uint8Array([1, 2, 3]))).toThrowError(DicomDecodeError);
    try {
      openDicom(new Uint8Array(200));
    } catch (err) {
      expect((err as DicomDecodeError).reason).toBe('corrupt');
    }
    const noPixels = buildDicom({ rows: 2, cols: 2, bitsAllocated: 8, pixels: Uint8Array.from([1, 2, 3, 4]), omitPixelData: true });
    expect(() => openDicom(noPixels)).toThrowError(/không có dữ liệu ảnh/);
    const full = buildDicom({ rows: 2, cols: 2, bitsAllocated: 16, pixels: Uint16Array.from([1, 2, 3, 4]) });
    expect(() => openDicom(full.slice(0, full.length - 4))).toThrowError(DicomDecodeError);
  });
});

describe('dicomNameMatches', () => {
  it('khớp không phân biệt dấu, hoa/thường, thứ tự từ; tệp không ghi tên thì coi là khớp', () => {
    expect(dicomNameMatches('NGUYEN VAN AN', 'Nguyễn Văn An')).toBe(true);
    expect(dicomNameMatches('AN VAN NGUYEN', 'Nguyễn Văn An')).toBe(true);
    expect(dicomNameMatches('Đặng Thị Bình', 'DANG THI BINH')).toBe(true);
    expect(dicomNameMatches('', 'Nguyễn Văn An')).toBe(true);
    expect(dicomNameMatches('NGUYEN VAN AN', '')).toBe(true);
  });
  it('khác tên → không khớp (kể cả thiếu hoặc thừa từ)', () => {
    expect(dicomNameMatches('NGUYEN VAN B', 'Nguyễn Văn An')).toBe(false);
    expect(dicomNameMatches('NGUYEN VAN', 'Nguyễn Văn An')).toBe(false);
    expect(dicomNameMatches('NGUYEN VAN AN BINH', 'Nguyễn Văn An')).toBe(false);
  });
  it('dicomPersonName / nameTokens', () => {
    expect(dicomPersonName('NGUYEN^VAN^AN')).toBe('NGUYEN VAN AN');
    expect(dicomPersonName('YAMADA^TAROU=山田^太郎')).toBe('YAMADA TAROU');
    expect(nameTokens('Trần  Thị-Mai')).toEqual(['TRAN', 'THI', 'MAI']);
  });
});

describe('bakeMono và viewStride', () => {
  it('đưa giá trị về 0–255 theo cửa sổ; đảo màu; giá trị ngoài cửa sổ bị cắt', () => {
    const raw = Uint16Array.from([0, 50, 100, 150, 200]);
    const out = bakeMono(raw, 1, 5, { slope: 1, intercept: 0, center: 100, width: 100, invert: false, stride: 1 });
    expect([0, 1, 2, 3, 4].map((i) => out.rgba[i * 4])).toEqual([0, 0, 128, 255, 255]);
    const inv = bakeMono(raw, 1, 5, { slope: 1, intercept: 0, center: 100, width: 100, invert: true, stride: 1 });
    expect(inv.rgba[0]).toBe(255);
    expect(inv.rgba[4 * 4]).toBe(0);
  });
  it('slope/intercept áp trước khi lấy cửa sổ', () => {
    const out = bakeMono(Uint16Array.from([1024]), 1, 1, { slope: 1, intercept: -1024, center: 0, width: 2, invert: false, stride: 1 });
    expect(out.rgba[0]).toBe(128);
  });
  it('ảnh rất lớn được thu nhỏ khi vẽ, ảnh thường không', () => {
    expect(viewStride(512, 512)).toBe(1);
    expect(viewStride(4096, 4096)).toBe(2);
    expect(viewStride(8000, 8000)).toBe(3);
    const out = bakeMono(new Uint8Array(16), 4, 4, { slope: 1, intercept: 0, center: 8, width: 16, invert: false, stride: 2 });
    expect([out.width, out.height]).toEqual([2, 2]);
  });
});
