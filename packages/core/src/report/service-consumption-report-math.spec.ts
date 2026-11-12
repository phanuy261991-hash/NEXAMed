import { describe, expect, it } from 'vitest';
import { averageCostPerVisit, indexConsumptionRevenue, serviceMarginPercent, topConsumedItemNames, visitRevenue, type ConsumptionRevenueLine } from './service-consumption-report-math';

describe('averageCostPerVisit', () => {
  it('chia và làm tròn nửa lên về 1 đồng', () => {
    expect(averageCostPerVisit(4_289_000, 368)).toBe(11_655);
    expect(averageCostPerVisit(10, 4)).toBe(3); // 2,5 → 3
    expect(averageCostPerVisit(9, 4)).toBe(2); // 2,25 → 2
    expect(averageCostPerVisit(0, 5)).toBe(0);
  });
  it('chưa có lượt nào thì null; chi phí âm không xảy ra nhưng không làm hỏng', () => {
    expect(averageCostPerVisit(1000, 0)).toBeNull();
    expect(averageCostPerVisit(-5, 2)).toBe(0);
  });
});

describe('topConsumedItemNames', () => {
  const items = [
    { name: 'Bông cồn', cost: 400, quantity: 4 },
    { name: 'Ống EDTA', cost: 2000, quantity: 1 },
    { name: 'Kim 21G', cost: 2000, quantity: 3 },
    { name: 'Găng', cost: 0, quantity: 9 },
  ];
  it('xếp theo chi phí, bằng nhau thì theo số lượng, rồi theo tên', () => {
    expect(topConsumedItemNames(items, 2)).toEqual(['Kim 21G', 'Ống EDTA']);
    expect(topConsumedItemNames(items, 3)).toEqual(['Kim 21G', 'Ống EDTA', 'Bông cồn']);
  });
  it('bỏ mặt hàng chi phí 0 khi còn mặt hàng có chi phí; toàn chi phí 0 thì vẫn liệt kê', () => {
    expect(topConsumedItemNames(items, 10)).not.toContain('Găng');
    expect(topConsumedItemNames([{ name: 'A', cost: 0, quantity: 2 }, { name: 'B', cost: 0, quantity: 5 }], 5)).toEqual(['B', 'A']);
  });
  it('limit 0 hoặc âm, danh sách rỗng → rỗng', () => {
    expect(topConsumedItemNames(items, 0)).toEqual([]);
    expect(topConsumedItemNames(items, -1)).toEqual([]);
    expect(topConsumedItemNames([], 3)).toEqual([]);
  });
});

const noSource = { sourceServiceItemId: null, sourceStockIssueLineId: null, sourceOrderItemId: null, sourceOrderPackageId: null };
const line = (over: Partial<ConsumptionRevenueLine> & { lineTotal: number }): ConsumptionRevenueLine => ({ discountType: null, discountValue: null, ...noSource, ...over });

describe('indexConsumptionRevenue — doanh thu ghi nhận của từng lượt dịch vụ', () => {
  it('dòng chỉ định lẻ và dịch vụ khám nhận đúng số tiền của dòng', () => {
    const index = indexConsumptionRevenue(
      [{ totalAmount: 800_000, discountType: null, discountValue: null, lines: [line({ lineTotal: 300_000, sourceOrderItemId: 'o1' }), line({ lineTotal: 500_000, sourceServiceItemId: 's1' })] }],
      [],
    );
    expect(visitRevenue(index, { orderItemId: 'o1', serviceItemId: null })).toBe(300_000);
    expect(visitRevenue(index, { orderItemId: null, serviceItemId: 's1' })).toBe(500_000);
  });

  it('chiết khấu toàn phiếu chia đều theo tỉ trọng dòng, tổng các dòng đúng bằng số phải thu (không lệch 1 đồng)', () => {
    const index = indexConsumptionRevenue(
      [{ totalAmount: 1_000_000, discountType: 'PERCENT', discountValue: 10, lines: [line({ lineTotal: 333_333, sourceOrderItemId: 'a' }), line({ lineTotal: 333_333, sourceOrderItemId: 'b' }), line({ lineTotal: 333_334, sourceOrderItemId: 'c' })] }],
      [],
    );
    const sum = visitRevenue(index, { orderItemId: 'a', serviceItemId: null }) + visitRevenue(index, { orderItemId: 'b', serviceItemId: null }) + visitRevenue(index, { orderItemId: 'c', serviceItemId: null });
    expect(sum).toBe(900_000);
  });

  it('chiết khấu riêng một dòng chỉ làm giảm dòng đó', () => {
    const index = indexConsumptionRevenue(
      [{ totalAmount: 600_000, discountType: null, discountValue: null, lines: [line({ lineTotal: 300_000, discountType: 'AMOUNT', discountValue: 100_000, sourceOrderItemId: 'a' }), line({ lineTotal: 300_000, sourceOrderItemId: 'b' })] }],
      [],
    );
    expect(visitRevenue(index, { orderItemId: 'a', serviceItemId: null })).toBe(200_000);
    expect(visitRevenue(index, { orderItemId: 'b', serviceItemId: null })).toBe(300_000);
  });

  it('dòng GÓI chia cho các dịch vụ trong gói theo giá niêm yết; tổng bằng tiền dòng gói', () => {
    const index = indexConsumptionRevenue(
      [{ totalAmount: 900_000, discountType: null, discountValue: null, lines: [line({ lineTotal: 900_000, sourceOrderPackageId: 'p1' })] }],
      [
        { packageId: 'p1', orderItemId: 'x', weight: 600_000 },
        { packageId: 'p1', orderItemId: 'y', weight: 300_000 },
        { packageId: 'p1', orderItemId: 'z', weight: 300_000 },
      ],
    );
    expect(visitRevenue(index, { orderItemId: 'x', serviceItemId: null })).toBe(450_000);
    expect(visitRevenue(index, { orderItemId: 'y', serviceItemId: null })).toBe(225_000);
    expect(visitRevenue(index, { orderItemId: 'z', serviceItemId: null })).toBe(225_000);
  });

  it('gói không có giá niêm yết thì chia đều; gói không còn dịch vụ nào thì không tạo doanh thu', () => {
    const index = indexConsumptionRevenue(
      [{ totalAmount: 100_000, discountType: null, discountValue: null, lines: [line({ lineTotal: 100_000, sourceOrderPackageId: 'p1' })] }],
      [
        { packageId: 'p1', orderItemId: 'x', weight: 0 },
        { packageId: 'p1', orderItemId: 'y', weight: 0 },
      ],
    );
    expect(visitRevenue(index, { orderItemId: 'x', serviceItemId: null })).toBe(50_000);
    expect(visitRevenue(index, { orderItemId: 'y', serviceItemId: null })).toBe(50_000);
    const empty = indexConsumptionRevenue([{ totalAmount: 100_000, discountType: null, discountValue: null, lines: [line({ lineTotal: 100_000, sourceOrderPackageId: 'p9' })] }], []);
    expect(empty.byOrderItem.size).toBe(0);
  });

  it('dòng thuốc cùng phiếu vẫn tham gia chia chiết khấu nhưng không gắn vào dịch vụ nào', () => {
    const index = indexConsumptionRevenue(
      [{ totalAmount: 200_000, discountType: 'AMOUNT', discountValue: 20_000, lines: [line({ lineTotal: 100_000, sourceOrderItemId: 'a' }), line({ lineTotal: 100_000, sourceStockIssueLineId: 'drug' })] }],
      [],
    );
    expect(visitRevenue(index, { orderItemId: 'a', serviceItemId: null })).toBe(90_000);
    expect(index.byOrderItem.size).toBe(1);
    expect(index.byServiceItem.size).toBe(0);
  });

  it('không tìm thấy dòng hoá đơn (phiếu huỷ hoặc hoàn toàn phần không được truyền vào) thì doanh thu 0', () => {
    const index = indexConsumptionRevenue([], []);
    expect(visitRevenue(index, { orderItemId: 'o1', serviceItemId: null })).toBe(0);
    expect(visitRevenue(index, { orderItemId: null, serviceItemId: 's1' })).toBe(0);
    expect(visitRevenue(index, { orderItemId: null, serviceItemId: null })).toBe(0);
  });

  it('phiếu không có dòng nào thì bỏ qua', () => {
    expect(indexConsumptionRevenue([{ totalAmount: 5, discountType: null, discountValue: null, lines: [] }], []).byOrderItem.size).toBe(0);
  });
});

describe('serviceMarginPercent', () => {
  it('lãi gộp ÷ doanh thu, một chữ số thập phân', () => {
    expect(serviceMarginPercent(36_000_000, 28_704_000)).toBe(79.7);
    expect(serviceMarginPercent(102_300_000, 77_642_000)).toBe(75.9);
  });
  it('doanh thu không dương (lượt đã hoàn tiền) thì null; lãi gộp âm vẫn ra phần trăm âm', () => {
    expect(serviceMarginPercent(0, -121_600)).toBeNull();
    expect(serviceMarginPercent(200_000, -50_000)).toBe(-25);
  });
});
