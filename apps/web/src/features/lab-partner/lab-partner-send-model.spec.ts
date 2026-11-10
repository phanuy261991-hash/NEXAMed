import { describe, expect, it } from 'vitest';
import type { LabPartnerOption, LabPartnerPendingRow } from '@nexamed/shared';
import { toVnDateAndTime, vnDateAndTimeToIso } from '../../shared/format/time';
import { buildDeliverySlipSpec, validatePdfFile, defaultOptionOf, initialPartnerId, keepEligible, optionFor, partnerChoicesOf, totalCost, validateSentAt } from './lab-partner-send-model';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const opt = (supplierId: string, amount: number | null, isDefault = false): LabPartnerOption => ({ supplierId, supplierCode: 'DT', supplierName: supplierId === A ? 'Bình Minh' : 'Nam Việt', isDefault, amount });

function row(id: string, options: LabPartnerOption[], collectedAt: string | null = '2026-11-06T01:00:00.000Z'): LabPartnerPendingRow {
  return {
    itemId: id,
    orderNo: `PCD-${id}`,
    patientId: A,
    patientName: 'Ngô Văn Tín',
    patientCode: 'BN2026-004872',
    serviceCode: 'XN1',
    serviceName: 'TSH',
    specimenName: 'Huyết thanh',
    tubeSid: `SID${id}`,
    collectedAt,
    collectedByName: null,
    options,
  };
}

describe('lab-partner-send-model', () => {
  const r1 = row('1', [opt(A, 90_000, true), opt(B, 80_000)]);
  const r2 = row('2', [opt(B, 235_000, true)]);
  const r3 = row('3', []);

  it('lấy đối tác mặc định, rơi về đối tác đầu, null khi chưa cấu hình', () => {
    expect(defaultOptionOf(r1)?.supplierId).toBe(A);
    expect(defaultOptionOf(r2)?.supplierId).toBe(B);
    expect(defaultOptionOf(row('x', [opt(B, 1), opt(A, 2)]))?.supplierId).toBe(B);
    expect(defaultOptionOf(r3)).toBeNull();
  });

  it('gộp danh sách đối tác không trùng theo thứ tự gặp', () => {
    expect(partnerChoicesOf([r1, r2, r3]).map((c) => c.supplierId)).toEqual([A, B]);
  });

  it('đối tác khởi đầu: mặc định phổ biến nhất trong dòng đã chọn, hoà thì dòng chọn trước', () => {
    const choices = partnerChoicesOf([r1, r2]);
    expect(initialPartnerId([r1, r2], choices)).toBe(A);
    expect(initialPartnerId([r2, r1], choices)).toBe(B);
    expect(initialPartnerId([r2, r2, r1], choices)).toBe(B);
    expect(initialPartnerId([], choices)).toBe(A);
    expect(initialPartnerId([r3], choices)).toBe(A);
    expect(initialPartnerId([], [])).toBe('');
  });

  it('đổi đối tác thì bỏ dòng chưa có giá cho đối tác mới', () => {
    const rows = [r1, r2, r3];
    expect([...keepEligible(rows, new Set(['1', '2', '3']), A)]).toEqual(['1']);
    expect([...keepEligible(rows, new Set(['1', '2', '3']), B)].sort()).toEqual(['1', '2']);
    expect(optionFor(r2, A)).toBeUndefined();
  });

  it('tổng giá trả áp đúng giá từng cặp; null khi người xem không thấy giá vốn', () => {
    expect(totalCost([r1, r2], new Set(['1', '2']), B)).toBe(315_000);
    expect(totalCost([r1], new Set(['1']), A)).toBe(90_000);
    expect(totalCost([r1, r2], new Set(), A)).toBe(0);
    const hidden = row('4', [opt(A, null, true)]);
    expect(totalCost([hidden], new Set(['4']), A)).toBeNull();
  });

  it('giờ gửi: không tương lai, không trước giờ lấy mẫu, không hợp lệ thì báo', () => {
    const now = new Date('2026-11-06T05:00:00.000Z').getTime();
    const rows = [row('1', [opt(A, 1)], '2026-11-06T01:00:00.000Z')];
    const checked = new Set(['1']);
    expect(validateSentAt('2026-11-06T04:00:00.000Z', rows, checked, now)).toBeNull();
    expect(validateSentAt('2026-11-06T06:00:00.000Z', rows, checked, now)).toMatch(/tương lai/);
    expect(validateSentAt('2026-11-06T00:30:00.000Z', rows, checked, now)).toMatch(/trước giờ lấy mẫu/);
    expect(validateSentAt('2026-11-06T00:30:00.000Z', rows, new Set(), now)).toBeNull();
    expect(validateSentAt(null, rows, checked, now)).toMatch(/ngày và giờ/);
  });
});

describe('giờ Việt Nam: ghép và tách ngày + giờ', () => {
  it('ghép ngày + giờ VN thành ISO UTC và ngược lại', () => {
    expect(vnDateAndTimeToIso('2026-11-06', '11:05')).toBe('2026-11-06T04:05:00.000Z');
    expect(vnDateAndTimeToIso('2026-11-06', '03:30')).toBe('2026-11-05T20:30:00.000Z');
    expect(toVnDateAndTime('2026-11-05T20:30:00.000Z')).toEqual({ date: '2026-11-06', time: '03:30' });
  });

  it('chuỗi sai định dạng thì trả null', () => {
    expect(vnDateAndTimeToIso('', '11:05')).toBeNull();
    expect(vnDateAndTimeToIso('2026-11-06', '')).toBeNull();
    expect(vnDateAndTimeToIso('06/11/2026', '11:05')).toBeNull();
  });
});

describe('phiếu giao mẫu và kiểm tệp PDF', () => {
  it('phiếu giao mẫu liệt kê mẫu đã tích, có hai ô ký và KHÔNG in giá trả', () => {
    const opt = (supplierId: string, amount: number) => ({ supplierId, supplierCode: 'DT', supplierName: 'Bình Minh', isDefault: true, amount });
    const rows = [
      { itemId: '1', orderNo: 'CLS1', patientId: 'p', patientName: 'Ngô Văn Tín', patientCode: 'BN1', serviceCode: 'X', serviceName: 'TSH', specimenName: 'Huyết thanh', tubeSid: '2611060002', collectedAt: null, collectedByName: null, options: [opt('a', 90_000)] },
    ];
    const spec = buildDeliverySlipSpec({ partnerName: 'Bình Minh', sentAtText: '06/11/2026 11:05', senderName: 'KTV Hà', note: 'Shipper 11h', rows });
    expect(spec.title).toBe('Phiếu giao mẫu xét nghiệm');
    expect(spec.sections[0]!.rows).toEqual([['1', '2611060002', 'Ngô Văn Tín', 'BN1', 'TSH', 'Huyết thanh']]);
    expect(spec.signatures).toHaveLength(2);
    expect(JSON.stringify(spec)).not.toContain('90000');
    expect(spec.infoLines?.[0]).toContain('Shipper 11h');
  });

  it('kiểm tệp PDF: rỗng, quá 10 MB, sai định dạng; hợp lệ theo đuôi hoặc kiểu', () => {
    expect(validatePdfFile({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toMatch(/rỗng/);
    expect(validatePdfFile({ name: 'a.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
    expect(validatePdfFile({ name: 'a.png', type: 'image/png', size: 100 })).toMatch(/PDF/);
    expect(validatePdfFile({ name: 'KQ.PDF', type: '', size: 100 })).toBeNull();
    expect(validatePdfFile({ name: 'ketqua', type: 'application/pdf', size: 100 })).toBeNull();
  });
});
