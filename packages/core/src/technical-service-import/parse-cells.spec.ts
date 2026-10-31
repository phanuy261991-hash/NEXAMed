import { describe, expect, it } from 'vitest';
import { IMPORT_RESULT_TYPE_LABELS, IMPORT_SERVICE_KIND_LABELS, parseImportResultType, parseImportServiceKind } from './parse-cells';

describe('parseImportServiceKind', () => {
  it('nhận nhãn chuẩn (và chính nhãn file mẫu xuất ra), có/không dấu, không phân biệt hoa thường', () => {
    for (const [kind, label] of Object.entries(IMPORT_SERVICE_KIND_LABELS)) {
      expect(parseImportServiceKind(label)).toEqual({ ok: true, value: kind });
    }
    expect(parseImportServiceKind('  XET NGHIEM ')).toEqual({ ok: true, value: 'LAB' });
    expect(parseImportServiceKind('cdha')).toEqual({ ok: true, value: 'IMAGING' });
    expect(parseImportServiceKind('Thăm dò chức năng')).toEqual({ ok: true, value: 'FUNCTIONAL' });
  });

  it('trống → null; nhãn lạ → lỗi', () => {
    expect(parseImportServiceKind(null)).toEqual({ ok: true, value: null });
    expect(parseImportServiceKind('   ')).toEqual({ ok: true, value: null });
    expect(parseImportServiceKind('Siêu âm')).toEqual({ ok: false });
  });
});

describe('parseImportResultType', () => {
  it('nhận nhãn file mẫu xuất ra và dạng gõ tắt', () => {
    for (const [type, label] of Object.entries(IMPORT_RESULT_TYPE_LABELS)) {
      expect(parseImportResultType(label)).toEqual({ ok: true, value: type });
    }
    expect(parseImportResultType('mô tả')).toEqual({ ok: true, value: 'NARRATIVE' });
    expect(parseImportResultType('Cả hai')).toEqual({ ok: true, value: 'BOTH' });
  });

  it('trống → null; lạ → lỗi', () => {
    expect(parseImportResultType(null)).toEqual({ ok: true, value: null });
    expect(parseImportResultType('Hình ảnh')).toEqual({ ok: false });
  });
});
