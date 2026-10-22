import { describe, expect, it } from 'vitest';
import {
  computeBillingTabCounts,
  computeReceptionDayCounts,
  computeReceptionTabCounts,
  matchesBillingSearch,
  matchesBillingTab,
  matchesReceptionSearch,
  matchesReceptionTab,
  type BillingFilterable,
  type ReceptionFilterable,
} from './day-list-filters';

const r = (over: Partial<ReceptionFilterable>): ReceptionFilterable => ({ fullName: 'Nguyễn Văn Ánh', encounterNo: 'LK2610000001', patientCode: 'BN2610000042', phone: '0912345678', status: 'CHECKED_IN', invoiceStatus: null, ...over });

describe('Bệnh nhân trong ngày — tab', () => {
  it('mỗi tab chỉ nhận đúng trạng thái của nó', () => {
    expect(matchesReceptionTab(r({ status: 'CHECKED_IN' }), 'WAITING')).toBe(true);
    expect(matchesReceptionTab(r({ status: 'IN_CONSULTATION' }), 'WAITING')).toBe(false);
    expect(matchesReceptionTab(r({ status: 'IN_CONSULTATION' }), 'IN_PROGRESS')).toBe(true);
    expect(matchesReceptionTab(r({ status: 'COMPLETED' }), 'DONE')).toBe(true);
    expect(matchesReceptionTab(r({ status: 'CANCELLED' }), 'DONE')).toBe(false);
    expect(matchesReceptionTab(r({ status: 'CANCELLED' }), 'ALL')).toBe(true);
  });

  it('"Chờ thanh toán" theo trạng thái phiếu thu UNPAID, không theo trạng thái lượt khám', () => {
    expect(matchesReceptionTab(r({ status: 'COMPLETED', invoiceStatus: 'UNPAID' }), 'UNPAID')).toBe(true);
    expect(matchesReceptionTab(r({ status: 'CHECKED_IN', invoiceStatus: 'PAID' }), 'UNPAID')).toBe(false);
    expect(matchesReceptionTab(r({ invoiceStatus: null }), 'UNPAID')).toBe(false);
  });

  it('ACTIVE = đang chờ + đang khám, không gồm hoàn tất/huỷ', () => {
    for (const [status, expected] of [['CHECKED_IN', true], ['IN_CONSULTATION', true], ['COMPLETED', false], ['CANCELLED', false], ['NO_SHOW', false]] as const) {
      expect(matchesReceptionTab(r({ status }), 'ACTIVE')).toBe(expected);
    }
  });
});

describe('Bệnh nhân trong ngày — tìm kiếm', () => {
  it('khớp họ tên, mã lượt khám, mã bệnh nhân không phân biệt hoa/thường, và số điện thoại', () => {
    expect(matchesReceptionSearch(r({}), 'nguyễn')).toBe(true);
    expect(matchesReceptionSearch(r({}), 'NGUYỄN VĂN')).toBe(true);
    expect(matchesReceptionSearch(r({}), 'lk2610000001')).toBe(true);
    expect(matchesReceptionSearch(r({}), 'bn2610000042')).toBe(true);
    expect(matchesReceptionSearch(r({}), '0912')).toBe(true);
  });

  it('không khớp → false; từ khoá rỗng/chỉ khoảng trắng/undefined khớp tất cả; cắt khoảng trắng hai đầu', () => {
    expect(matchesReceptionSearch(r({}), 'trần')).toBe(false);
    expect(matchesReceptionSearch(r({}), '')).toBe(true);
    expect(matchesReceptionSearch(r({}), '   ')).toBe(true);
    expect(matchesReceptionSearch(r({}), undefined)).toBe(true);
    expect(matchesReceptionSearch(r({}), '  ánh  ')).toBe(true);
  });
});

describe('Bệnh nhân trong ngày — đếm', () => {
  const day = [
    r({ status: 'CHECKED_IN', invoiceStatus: 'UNPAID' }),
    r({ status: 'CHECKED_IN', invoiceStatus: 'PAID' }),
    r({ status: 'IN_CONSULTATION', invoiceStatus: 'PAID' }),
    r({ status: 'COMPLETED', invoiceStatus: 'PAID' }),
    r({ status: 'COMPLETED', invoiceStatus: 'UNPAID' }),
    r({ status: 'CANCELLED', invoiceStatus: null }),
    r({ status: 'NO_SHOW', invoiceStatus: null }),
  ];

  it('thẻ KPI: tổng KHÔNG gồm huỷ/không đến; huỷ gồm cả không đến', () => {
    expect(computeReceptionDayCounts(day)).toEqual({ total: 5, waiting: 2, inProgress: 1, unpaid: 2, done: 2, cancelled: 2 });
  });

  it('số trên tab: "Tất cả" gồm mọi dòng kể cả huỷ (đúng bản web cũ)', () => {
    expect(computeReceptionTabCounts(day)).toEqual({ all: 7, waiting: 2, inProgress: 1, unpaid: 2, done: 2 });
  });

  it('ngày rỗng → toàn số 0', () => {
    expect(computeReceptionDayCounts([])).toEqual({ total: 0, waiting: 0, inProgress: 0, unpaid: 0, done: 0, cancelled: 0 });
    expect(computeReceptionTabCounts([])).toEqual({ all: 0, waiting: 0, inProgress: 0, unpaid: 0, done: 0 });
  });
});

const b = (over: Partial<BillingFilterable>): BillingFilterable => ({ invoiceNo: 'PT2610000078', encounterNo: 'LK2610000064', fullName: 'Trần Thị Bích', patientCode: 'BN2610003075', status: 'UNPAID', ...over });

describe('Thu ngân — tab, tìm kiếm, đếm', () => {
  it('tab Chờ thu / Đã thu / Tất cả', () => {
    expect(matchesBillingTab(b({ status: 'UNPAID' }), 'UNPAID')).toBe(true);
    expect(matchesBillingTab(b({ status: 'PAID' }), 'UNPAID')).toBe(false);
    expect(matchesBillingTab(b({ status: 'PAID' }), 'PAID')).toBe(true);
    expect(matchesBillingTab(b({ status: 'REFUNDED' }), 'PAID')).toBe(false);
    expect(matchesBillingTab(b({ status: 'CANCELLED' }), 'ALL')).toBe(true);
  });

  it('tìm theo mã phiếu thu, mã lượt khám, họ tên, mã bệnh nhân; KHÔNG tìm theo số điện thoại (không có ở phiếu thu)', () => {
    expect(matchesBillingSearch(b({}), 'pt2610000078')).toBe(true);
    expect(matchesBillingSearch(b({}), 'LK2610000064')).toBe(true);
    expect(matchesBillingSearch(b({}), 'trần thị')).toBe(true);
    expect(matchesBillingSearch(b({}), 'bn2610003075')).toBe(true);
    expect(matchesBillingSearch(b({}), 'lê')).toBe(false);
    expect(matchesBillingSearch(b({}), '  ')).toBe(true);
  });

  it('đếm 3 tab: phiếu hoàn/huỷ chỉ nằm trong "Tất cả"', () => {
    const day = [b({ status: 'UNPAID' }), b({ status: 'UNPAID' }), b({ status: 'PAID' }), b({ status: 'REFUNDED' }), b({ status: 'CANCELLED' })];
    expect(computeBillingTabCounts(day)).toEqual({ unpaid: 2, paid: 1, all: 5 });
    expect(computeBillingTabCounts([])).toEqual({ unpaid: 0, paid: 0, all: 0 });
  });
});
