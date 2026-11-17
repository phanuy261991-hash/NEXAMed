/**
 * Dựng tệp DICOM tổng hợp (Part 10, VR tường minh Little Endian) cho test của bộ đọc — chỉ dùng trong test, không vào bản chạy thật.
 */
export interface BuildDicomOptions {
  rows: number;
  cols: number;
  bitsAllocated: 8 | 16;
  pixels: Uint8Array | Uint16Array | Int16Array;
  frames?: number;
  samples?: 1 | 3;
  planar?: boolean;
  signed?: boolean;
  photometric?: string;
  transferSyntax?: string;
  patientName?: string;
  patientId?: string;
  modality?: string;
  studyDate?: string;
  studyTime?: string;
  pixelSpacing?: string;
  windowCenter?: string;
  windowWidth?: string;
  slope?: string;
  intercept?: string;
  omitPixelData?: boolean;
}

const enc = new TextEncoder();

function even(bytes: Uint8Array, pad: number): Uint8Array {
  if (bytes.length % 2 === 0) return bytes;
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  out[bytes.length] = pad;
  return out;
}

/** Một phần tử VR tường minh: (group,element) + VR + độ dài + giá trị. `longForm` cho OB/OW/UN (độ dài 32 bit). */
function element(group: number, el: number, vr: string, value: Uint8Array, longForm = false): Uint8Array {
  const head = longForm ? 12 : 8;
  const out = new Uint8Array(head + value.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, group, true);
  dv.setUint16(2, el, true);
  out[4] = vr.charCodeAt(0);
  out[5] = vr.charCodeAt(1);
  if (longForm) dv.setUint32(8, value.length, true);
  else dv.setUint16(6, value.length, true);
  out.set(value, head);
  return out;
}

const str = (g: number, e: number, vr: string, v: string): Uint8Array => element(g, e, vr, even(enc.encode(v), vr === 'UI' ? 0 : 0x20));
const us = (g: number, e: number, v: number): Uint8Array => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
  return element(g, e, 'US', b);
};

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function buildDicom(o: BuildDicomOptions): Uint8Array {
  const ts = o.transferSyntax ?? '1.2.840.10008.1.2.1';
  const meta = concat([str(0x0002, 0x0010, 'UI', ts)]);
  const metaGroup = concat([element(0x0002, 0x0000, 'UL', (() => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, meta.length, true); return b; })()), meta]);

  const samples = o.samples ?? 1;
  const parts: Uint8Array[] = [];
  if (o.studyDate) parts.push(str(0x0008, 0x0020, 'DA', o.studyDate));
  if (o.studyTime) parts.push(str(0x0008, 0x0030, 'TM', o.studyTime));
  if (o.modality) parts.push(str(0x0008, 0x0060, 'CS', o.modality));
  if (o.patientName) parts.push(str(0x0010, 0x0010, 'PN', o.patientName));
  if (o.patientId) parts.push(str(0x0010, 0x0020, 'LO', o.patientId));
  parts.push(us(0x0028, 0x0002, samples));
  parts.push(str(0x0028, 0x0004, 'CS', o.photometric ?? 'MONOCHROME2'));
  if (samples === 3) parts.push(us(0x0028, 0x0006, o.planar ? 1 : 0));
  if ((o.frames ?? 1) > 1) parts.push(str(0x0028, 0x0008, 'IS', String(o.frames)));
  parts.push(us(0x0028, 0x0010, o.rows));
  parts.push(us(0x0028, 0x0011, o.cols));
  if (o.pixelSpacing) parts.push(str(0x0028, 0x0030, 'DS', o.pixelSpacing));
  parts.push(us(0x0028, 0x0100, o.bitsAllocated));
  parts.push(us(0x0028, 0x0101, o.bitsAllocated));
  parts.push(us(0x0028, 0x0102, o.bitsAllocated - 1));
  parts.push(us(0x0028, 0x0103, o.signed ? 1 : 0));
  if (o.windowCenter) parts.push(str(0x0028, 0x1050, 'DS', o.windowCenter));
  if (o.windowWidth) parts.push(str(0x0028, 0x1051, 'DS', o.windowWidth));
  if (o.intercept) parts.push(str(0x0028, 0x1052, 'DS', o.intercept));
  if (o.slope) parts.push(str(0x0028, 0x1053, 'DS', o.slope));
  if (!o.omitPixelData) {
    const px = new Uint8Array(o.pixels.buffer, o.pixels.byteOffset, o.pixels.byteLength);
    parts.push(element(0x7fe0, 0x0010, o.bitsAllocated === 8 ? 'OB' : 'OW', px, true));
  }
  return concat([new Uint8Array(128), enc.encode('DICM'), metaGroup, ...parts]);
}
