import { describe, expect, it } from 'vitest';
import type { PharmacyControlledReport, PharmacyDispensedReport, PharmacyMarginReport } from '@nexamed/shared';
import { buildPharmacyControlledPrintSpec, buildPharmacyDispensedPrintSpec, buildPharmacyMarginPrintSpec } from './pharmacy-print-builders';

const header = { generatedAt: '2026-11-05T08:00:00.000Z', from: '2026-10-01', to: '2026-10-31', branchCount: 1 };
const ctx = { from: '2026-10-01', to: '2026-10-31', scopeLabel: null };
const id = '00000000-0000-4000-8000-000000000001';

describe('bản in Thuốc và vật tư', () => {
  it('Đã phát: tiêu đề, kỳ, Loại đang lọc, cột và hàng đúng thứ tự', () => {
    const report: PharmacyDispensedReport = {
      ...header,
      itemType: 'MEDICINE',
      issueCount: 3,
      itemCount: 1,
      amount: 60_000,
      returnedAmount: 40_000,
      rows: [{ drugId: id, code: 'MOR', name: 'Morphin 10mg', itemType: 'MEDICINE', unitName: 'Viên', quantity: 5, returnedQuantity: 2, netQuantity: 3, issueCount: 1, amount: 60_000 }],
    };
    const spec = buildPharmacyDispensedPrintSpec(report, { ...ctx, scopeLabel: 'Quận 1, Quận 7' });
    expect(spec.title).toBe('Thuốc và vật tư đã phát');
    expect(spec.subtitleLines).toEqual(['Từ 01/10/2026 đến 31/10/2026', 'Phạm vi: Quận 1, Quận 7', 'Loại: Thuốc']);
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).toEqual(['Mã', 'Mặt hàng', 'Loại', 'ĐVT', 'Đã xuất', 'Khách trả lại', 'Thực phát', 'Số phiếu', 'Giá trị thực phát']);
    expect(section.rows[0]).toEqual(['MOR', 'Morphin 10mg', 'Thuốc', 'Viên', '5', '2', '3', '1', '60.000']);
    expect(spec.note).toBeUndefined();
  });

  it('Đã phát: danh sách bị cắt thì bản in ghi chú rõ', () => {
    const report: PharmacyDispensedReport = { ...header, itemType: 'ALL', issueCount: 0, itemCount: 1500, amount: 0, returnedAmount: 0, rows: [] };
    expect(buildPharmacyDispensedPrintSpec(report, ctx).note).toContain('1.500');
  });

  it('Lãi gộp: dòng Cộng tính trên tất cả, biên "—" khi tiền bán không dương, vật tư ghi "Vật tư"', () => {
    const report: PharmacyMarginReport = {
      ...header,
      itemType: 'ALL',
      totals: { sell: 225_000, cost: 124_000, margin: 101_000, marginPercent: 44.9, itemCount: 2 },
      rows: [
        { drugId: id, code: 'PARA', name: 'Paracetamol 500mg', itemType: 'MEDICINE', unitName: 'Viên', quantity: 150, sell: 145_000, cost: 75_000, margin: 70_000, marginPercent: 48.3 },
        { drugId: id, code: 'GANG', name: 'Găng tay y tế', itemType: 'SUPPLY', unitName: 'Đôi', quantity: 10, sell: 0, cost: 13_000, margin: -13_000, marginPercent: null },
      ],
    };
    const spec = buildPharmacyMarginPrintSpec(report, ctx);
    expect(spec.title).toBe('Lãi gộp thuốc và vật tư');
    const section = spec.sections[0]!;
    expect(section.rows[0]).toEqual(['Paracetamol 500mg', 'Thuốc', 'Viên', '150', '145.000', '75.000', '70.000', '48,3%']);
    expect(section.rows[1]).toEqual(['Găng tay y tế', 'Vật tư', 'Đôi', '10', '0', '13.000', '-13.000', '—']);
    expect(section.totalRows![0]).toEqual(['Cộng 2 mặt hàng', '', '', '', '225.000', '124.000', '101.000', '44,9%']);
    expect(spec.infoLines!.join(' ')).toContain('chưa trừ nhân sự, mặt bằng, khấu hao');
  });

  it('Kiểm soát đặc biệt: hai bảng; cột Chi nhánh chỉ có khi gộp nhiều chi nhánh; ghi rõ không phải mẫu gửi cơ quan quản lý', () => {
    const report: PharmacyControlledReport = {
      ...header,
      controlType: 'NARCOTIC',
      itemCount: 1,
      entryCount: 1,
      rows: [{ drugId: id, code: 'MOR', name: 'Morphin 10mg', controlType: 'NARCOTIC', unitName: 'Viên', openingQuantity: 50, receivedQuantity: 22, dispensedQuantity: 5, otherOutQuantity: 3, closingQuantity: 64 }],
      entries: [{ date: '2026-10-12', issueNo: 'PX001', drugCode: 'MOR', drugName: 'Morphin 10mg', controlType: 'NARCOTIC', unitName: 'Viên', quantity: 5, patientCode: 'BN1', patientName: 'Nguyễn An', branchName: 'Quận 1' }],
    };
    const single = buildPharmacyControlledPrintSpec(report, ctx);
    expect(single.subtitleLines).toEqual(['Từ 01/10/2026 đến 31/10/2026', 'Phân loại: Gây nghiện']);
    expect(single.sections).toHaveLength(2);
    expect(single.sections[0]!.rows[0]).toEqual(['MOR', 'Morphin 10mg', 'Gây nghiện', 'Viên', '50', '22', '5', '3', '64']);
    expect(single.sections[1]!.columns.map((c) => c.header)).not.toContain('Chi nhánh');
    expect(single.infoLines!.join(' ')).toContain('không phải mẫu báo cáo gửi cơ quan quản lý');
    const multi = buildPharmacyControlledPrintSpec({ ...report, branchCount: 2 }, ctx);
    expect(multi.sections[1]!.columns.map((c) => c.header)).toContain('Chi nhánh');
    expect(multi.sections[1]!.rows[0]).toContain('Quận 1');
  });
});
