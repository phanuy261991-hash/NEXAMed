import { describe, expect, it } from 'vitest';
import { resolveCardValidity, deriveReceptionInsuranceView, detectInsuranceCardKind, formatValidityRange, formatWarningMessage, insuranceBadgeLabel, normalizeInsuranceCardNo } from './insurance-card-view';

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

describe('deriveReceptionInsuranceView (khối chọn thẻ ở Tiếp nhận)', () => {
  const card = (id: string, validity: 'VALID' | 'UNKNOWN_EXPIRY' | 'EXPIRED' | 'NOT_STARTED') => ({ id, validity, validTo: null });

  it('chưa có thẻ nào', () => {
    expect(deriveReceptionInsuranceView([], null, undefined)).toEqual({ mode: 'NO_CARDS' });
  });

  it('chỉ có thẻ hết hạn / chưa hiệu lực → không chọn được, báo thẻ hết hạn', () => {
    const view = deriveReceptionInsuranceView([card('a', 'NOT_STARTED'), card('b', 'EXPIRED')], null, undefined);
    expect(view).toMatchObject({ mode: 'INELIGIBLE', card: { id: 'b' } });
  });

  it('theo gợi ý khi chưa bấm gì; thẻ hết hạn không nằm trong danh sách chọn', () => {
    const view = deriveReceptionInsuranceView([card('a', 'VALID'), card('b', 'UNKNOWN_EXPIRY'), card('c', 'EXPIRED')], 'a', undefined);
    expect(view).toMatchObject({ mode: 'PICK', selected: { id: 'a' }, isSuggested: true });
    expect(view.mode === 'PICK' && view.picks.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('lễ tân chọn thẻ khác hoặc "Không dùng thẻ" thì không còn là gợi ý', () => {
    const cards = [card('a', 'VALID'), card('b', 'UNKNOWN_EXPIRY')];
    expect(deriveReceptionInsuranceView(cards, 'a', 'b')).toMatchObject({ selected: { id: 'b' }, isSuggested: false });
    expect(deriveReceptionInsuranceView(cards, 'a', null)).toMatchObject({ selected: null, isSuggested: false });
  });

  it('lựa chọn cũ trỏ thẻ không còn trong danh sách → coi như không dùng thẻ', () => {
    expect(deriveReceptionInsuranceView([card('a', 'VALID')], 'a', 'đã-xoá')).toMatchObject({ selected: null });
  });
});

/** Bộ vector DÙNG CHUNG với `resolveInsuranceCardValidity` ở packages/core — đổi một bên phải đổi bên kia. */
describe('resolveCardValidity (bản sao của packages/core)', () => {
  it.each([
    { from: null, to: null, today: '2026-10-21', expected: 'UNKNOWN_EXPIRY' },
    { from: '2026-01-01', to: '2026-12-31', today: '2026-10-21', expected: 'VALID' },
    { from: '2026-01-01', to: '2026-10-21', today: '2026-10-21', expected: 'VALID' },
    { from: '2025-01-01', to: '2026-10-20', today: '2026-10-21', expected: 'EXPIRED' },
    { from: '2026-10-22', to: '2026-12-31', today: '2026-10-21', expected: 'NOT_STARTED' },
    { from: '2026-10-22', to: null, today: '2026-10-21', expected: 'NOT_STARTED' },
    { from: null, to: '2026-12-31', today: '2026-10-21', expected: 'VALID' },
  ] as const)('%j', ({ from, to, today, expected }) => {
    expect(resolveCardValidity({ validFrom: from, validTo: to }, today)).toBe(expected);
  });
});
