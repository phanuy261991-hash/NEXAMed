import { describe, expect, it } from 'vitest';
import { detectInsuranceCardKind, formatValidityRange, formatWarningMessage, insuranceBadgeLabel, normalizeInsuranceCardNo } from './insurance-card-view';

/** Bộ vector DÙNG CHUNG với `packages/core/src/insurance/insurance-card.spec.ts` — đổi một bên phải đổi bên kia. */
const KIND_VECTORS: { raw: string; normalized: string; kind: 'NEW_12' | 'OLD_15' | 'UNKNOWN' }[] = [
  { raw: '079193004512', normalized: '079193004512', kind: 'NEW_12' },
  { raw: '079 193-004 512', normalized: '079193004512', kind: 'NEW_12' },
  { raw: 'dn4797915123456', normalized: 'DN4797915123456', kind: 'OLD_15' },
  { raw: 'DN 4 79 79151 23456', normalized: 'DN4797915123456', kind: 'OLD_15' },
  { raw: '123456789012345', normalized: '123456789012345', kind: 'OLD_15' },
  { raw: '0791930045', normalized: '0791930045', kind: 'UNKNOWN' },
  { raw: '07919300451', normalized: '07919300451', kind: 'UNKNOWN' },
  { raw: '0791930045123', normalized: '0791930045123', kind: 'UNKNOWN' },
  { raw: 'DN47979151234567', normalized: 'DN47979151234567', kind: 'UNKNOWN' },
  { raw: 'DN4797915123!56', normalized: 'DN4797915123!56', kind: 'UNKNOWN' },
  { raw: '', normalized: '', kind: 'UNKNOWN' },
];

describe('chuẩn hoá + nhận diện số thẻ (bản sao của packages/core)', () => {
  it.each(KIND_VECTORS)('%j', ({ raw, normalized, kind }) => {
    expect(normalizeInsuranceCardNo(raw)).toBe(normalized);
    expect(detectInsuranceCardKind(normalizeInsuranceCardNo(raw))).toBe(kind);
  });

  it('12 ký tự có chữ KHÔNG phải thẻ mới', () => {
    expect(detectInsuranceCardKind('07919300451A')).toBe('UNKNOWN');
  });
});

describe('định dạng hiển thị', () => {
  it('hiệu lực: đủ hai ngày, chỉ có hạn, thiếu hạn', () => {
    expect(formatValidityRange('2026-01-01', '2026-12-31')).toBe('01/01/2026 – 31/12/2026');
    expect(formatValidityRange(null, '2026-12-31')).toBe('đến 31/12/2026');
    expect(formatValidityRange('2026-01-01', null)).toBe('Chưa rõ hạn');
    expect(formatValidityRange(null, null)).toBe('Chưa rõ hạn');
  });

  it('nhãn gọn: BHYT kèm mức hưởng, BHYT không mức hưởng, tự chi trả', () => {
    expect(insuranceBadgeLabel({ selfPay: false, benefitRate: 80 })).toBe('BHYT 80%');
    expect(insuranceBadgeLabel({ selfPay: false, benefitRate: null })).toBe('BHYT');
    expect(insuranceBadgeLabel({ selfPay: true, benefitRate: null })).toBe('Tự chi trả');
  });

  it('cảnh báo định dạng nêu số ký tự hiện có và chỉ ra khi chỉ gồm chữ số', () => {
    expect(formatWarningMessage('0791930045')).toContain('10 ký tự (chỉ gồm chữ số)');
    expect(formatWarningMessage('07919300451A')).toContain('12 ký tự,');
  });
});
