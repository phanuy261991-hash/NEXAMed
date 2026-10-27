import { describe, expect, it } from 'vitest';
import type { EncounterInsurance } from '@nexamed/shared';
import { formatInsurancePrintValue } from './insurance-print';

const card: EncounterInsurance = {
  selfPay: false,
  reason: null,
  cardNo: 'DN4797915123456',
  cardNoUnreadable: false,
  kind: 'OLD_15',
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
  facilityCode: '79005',
  facilityName: 'Phòng khám Đa khoa Tân Bình',
  benefitRate: 80,
};
const selfPay: EncounterInsurance = { selfPay: true, reason: 'NO_CARD', cardNo: null, cardNoUnreadable: false, kind: null, validFrom: null, validTo: null, facilityCode: null, facilityName: null, benefitRate: null };

describe('formatInsurancePrintValue (cùng câu chữ với bệnh án PDF của máy chủ)', () => {
  it('thẻ cũ có đủ hiệu lực: số thẻ, kiểu thẻ, hiệu lực, mức hưởng, nơi đăng ký', () => {
    expect(formatInsurancePrintValue(card, 'hide')).toBe('DN4797915123456 (thẻ cũ) · hiệu lực 01/01/2026 – 31/12/2026 · hưởng 80% · nơi ĐK KCB: Phòng khám Đa khoa Tân Bình');
  });

  it('thẻ mới chưa rõ hạn: có ngày bắt đầu thì ghi "từ …, chưa rõ hạn"; không có ngày nào thì không ghi hạn', () => {
    expect(formatInsurancePrintValue({ ...card, cardNo: '079193004512', kind: 'NEW_12', validTo: null, facilityName: null, benefitRate: null }, 'hide')).toBe('079193004512 (thẻ mới) · từ 01/01/2026, chưa rõ hạn');
    expect(formatInsurancePrintValue({ ...card, cardNo: '079193004512', kind: 'NEW_12', validFrom: null, validTo: null, facilityName: null, benefitRate: 95 }, 'hide')).toBe('079193004512 (thẻ mới) · hưởng 95%');
  });

  it('chỉ có hạn: "đến …"', () => {
    expect(formatInsurancePrintValue({ ...card, validFrom: null, facilityName: null, benefitRate: null }, 'hide')).toBe('DN4797915123456 (thẻ cũ) · đến 31/12/2026');
  });

  it('tự chi trả: ẩn cả dòng hoặc in "Tự chi trả" theo bản mẫu', () => {
    expect(formatInsurancePrintValue(selfPay, 'hide')).toBeNull();
    expect(formatInsurancePrintValue(selfPay, 'selfPay')).toBe('Tự chi trả');
  });

  it('khoá mã hoá lệch dữ liệu (không đọc được số thẻ): KHÔNG in dòng nào, kể cả khi bản mẫu chọn "In Tự chi trả" (in vậy là sai sự thật)', () => {
    const unreadable: EncounterInsurance = { ...card, cardNo: null, cardNoUnreadable: true, kind: null };
    expect(formatInsurancePrintValue(unreadable, 'selfPay')).toBeNull();
    expect(formatInsurancePrintValue(unreadable, 'hide')).toBeNull();
  });

  it('không có thông tin BHYT (công tắc tắt) thì không in gì', () => {
    expect(formatInsurancePrintValue(null, 'selfPay')).toBeNull();
    expect(formatInsurancePrintValue(undefined, 'hide')).toBeNull();
  });
});
