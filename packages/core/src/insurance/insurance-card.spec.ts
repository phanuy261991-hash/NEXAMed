import { describe, expect, it } from 'vitest';
import { detectInsuranceCardKind, normalizeInsuranceCardNo, pickSuggestedInsuranceCard, resolveInsuranceCardValidity } from './insurance-card';

/** Bộ vector DÙNG CHUNG với bản sao ở web (`insurance-card-view.spec.ts`) — đổi một bên phải đổi bên kia. */
export const KIND_VECTORS: { raw: string; normalized: string; kind: 'NEW_12' | 'OLD_15' | 'UNKNOWN' }[] = [
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

describe('normalizeInsuranceCardNo + detectInsuranceCardKind', () => {
  it.each(KIND_VECTORS)('%j', ({ raw, normalized, kind }) => {
    expect(normalizeInsuranceCardNo(raw)).toBe(normalized);
    expect(detectInsuranceCardKind(normalizeInsuranceCardNo(raw))).toBe(kind);
  });

  it('12 ký tự có chữ KHÔNG phải thẻ mới (thẻ mới chỉ gồm chữ số)', () => {
    expect(detectInsuranceCardKind('07919300451A')).toBe('UNKNOWN');
  });
});

describe('resolveInsuranceCardValidity', () => {
  const today = '2026-10-21';
  it('trống cả hai ngày = chưa rõ hạn (không coi là hết hạn)', () => {
    expect(resolveInsuranceCardValidity({ validFrom: null, validTo: null }, today)).toBe('UNKNOWN_EXPIRY');
  });
  it('có ngày bắt đầu nhưng trống hạn = chưa rõ hạn', () => {
    expect(resolveInsuranceCardValidity({ validFrom: '2026-01-01', validTo: null }, today)).toBe('UNKNOWN_EXPIRY');
  });
  it('trong khoảng = còn hiệu lực, kể cả đúng ngày cuối', () => {
    expect(resolveInsuranceCardValidity({ validFrom: '2026-01-01', validTo: '2026-12-31' }, today)).toBe('VALID');
    expect(resolveInsuranceCardValidity({ validFrom: '2026-01-01', validTo: '2026-10-21' }, today)).toBe('VALID');
  });
  it('quá ngày cuối = hết hạn; trước ngày đầu = chưa hiệu lực', () => {
    expect(resolveInsuranceCardValidity({ validFrom: '2026-01-01', validTo: '2026-10-20' }, today)).toBe('EXPIRED');
    expect(resolveInsuranceCardValidity({ validFrom: null, validTo: '2026-10-20' }, today)).toBe('EXPIRED');
    expect(resolveInsuranceCardValidity({ validFrom: '2026-10-22', validTo: '2027-10-21' }, today)).toBe('NOT_STARTED');
  });
});

describe('pickSuggestedInsuranceCard', () => {
  const today = '2026-10-21';
  const mk = (id: string, createdAt: string, validFrom: string | null, validTo: string | null) => ({ id, createdAt, validFrom, validTo });

  it('không có thẻ → null', () => {
    expect(pickSuggestedInsuranceCard([], today)).toBeNull();
  });
  it('ưu tiên thẻ còn hiệu lực hơn thẻ chưa rõ hạn dù thẻ chưa rõ hạn thêm sau', () => {
    const cards = [mk('new', '2026-10-01T00:00:00Z', null, null), mk('old', '2026-01-01T00:00:00Z', '2026-01-01', '2026-12-31')];
    expect(pickSuggestedInsuranceCard(cards, today)?.id).toBe('old');
  });
  it('cùng mức ưu tiên thì lấy thẻ thêm gần nhất', () => {
    const cards = [mk('a', '2026-03-01T00:00:00Z', '2026-01-01', '2026-12-31'), mk('b', '2026-05-01T00:00:00Z', '2026-01-01', '2026-12-31')];
    expect(pickSuggestedInsuranceCard(cards, today)?.id).toBe('b');
  });
  it('chỉ có thẻ chưa rõ hạn thì gợi ý thẻ đó', () => {
    expect(pickSuggestedInsuranceCard([mk('u', '2026-10-01T00:00:00Z', null, null)], today)?.id).toBe('u');
  });
  it('thẻ hết hạn và thẻ chưa đến ngày hiệu lực KHÔNG được gợi ý', () => {
    const cards = [mk('exp', '2026-01-01T00:00:00Z', '2025-01-01', '2025-12-31'), mk('fut', '2026-02-01T00:00:00Z', '2027-01-01', '2027-12-31')];
    expect(pickSuggestedInsuranceCard(cards, today)).toBeNull();
  });
});
