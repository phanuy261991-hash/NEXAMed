import { describe, expect, it } from 'vitest';
import { DEFAULT_RECORD_BUNDLE, RECORD_BUNDLE_DOCUMENT_TYPES, recordBundleSummary } from './record-bundle';

describe('recordBundleSummary — mô tả bộ hồ sơ in (#272)', () => {
  const counts = { paraclinical: 2, prescriptions: 1 };
  it('mặc định kèm hết: kể cả phiếu kết quả lẫn đơn thuốc', () => {
    expect(recordBundleSummary(counts)).toBe('Tờ khám theo mẫu + 2 phiếu kết quả + 1 đơn thuốc');
    expect(recordBundleSummary(counts, DEFAULT_RECORD_BUNDLE)).toBe('Tờ khám theo mẫu + 2 phiếu kết quả + 1 đơn thuốc');
  });
  it('tắt từng phần → bỏ phần đó, tờ khám luôn có', () => {
    expect(recordBundleSummary(counts, { includeParaclinical: false, includePrescriptions: true })).toBe('Tờ khám theo mẫu + 1 đơn thuốc');
    expect(recordBundleSummary(counts, { includeParaclinical: true, includePrescriptions: false })).toBe('Tờ khám theo mẫu + 2 phiếu kết quả');
    expect(recordBundleSummary(counts, { includeParaclinical: false, includePrescriptions: false })).toBe('Tờ khám theo mẫu');
  });
  it('bật nhưng lượt khám không có thì không kể (không nói "0 đơn thuốc")', () => {
    expect(recordBundleSummary({ paraclinical: 0, prescriptions: 0 })).toBe('Tờ khám theo mẫu');
  });
  it('chỉ bản mẫu Bệnh án có khối này', () => {
    expect(RECORD_BUNDLE_DOCUMENT_TYPES).toEqual(['MEDICAL_RECORD']);
  });
});
