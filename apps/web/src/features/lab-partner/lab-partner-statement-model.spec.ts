import { describe, expect, it } from 'vitest';
import type { LabPartnerStatementResponse, LabPartnerStatementRow } from '@nexamed/shared';
import { buildLabPartnerStatementPrintSpec, formatTurnaround, nextDateString, statementHasMultipleBranches, statementPeriodLabel, statementStateView } from './lab-partner-statement-model';

const row = (over: Partial<LabPartnerStatementRow>): LabPartnerStatementRow => ({
  itemId: '0198a000-0000-7000-8000-000000000001',
  dispatchNo: 'GM2611000001',
  tubeSid: '2611050004',
  patientName: 'Bùi Thị Lan Anh',
  patientCode: 'BN2026-004851',
  serviceName: 'HBsAg',
  sentAt: '2026-11-05T03:30:00.000Z',
  receivedAt: '2026-11-05T09:20:00.000Z',
  turnaroundMinutes: 350,
  state: 'DONE',
  late: false,
  amount: 60_000,
  branchName: 'Phòng khám An Phúc',
  rejectReason: null,
  ...over,
});

const data = (items: LabPartnerStatementRow[], over: Partial<LabPartnerStatementResponse['summary']> = {}, truncated = false): Pick<LabPartnerStatementResponse, 'items' | 'summary' | 'truncated'> => ({
  items,
  truncated,
  summary: { doneCount: 1, doneAmount: 60_000, waitingCount: 0, waitingAmount: 0, rejectedCount: 0, lateCount: 0, openingBalance: 0, periodAccrued: 60_000, periodPaid: 0, closingBalance: 60_000, ...over },
});

const ctx = { supplierCode: 'DT0001', supplierName: 'Phòng xét nghiệm Bình Minh', from: '2026-11-01', to: '2026-11-06', basis: 'RECEIVED' as const };

describe('formatTurnaround', () => {
  it('phút, giờ, giờ + phút, ngày + giờ, chưa có', () => {
    expect(formatTurnaround(40)).toBe('40 phút');
    expect(formatTurnaround(360)).toBe('6 giờ');
    expect(formatTurnaround(350)).toBe('5 giờ 50 phút');
    expect(formatTurnaround(48 * 60 + 15)).toBe('2 ngày 0 giờ');
    expect(formatTurnaround(27 * 60)).toBe('1 ngày 3 giờ');
    expect(formatTurnaround(0)).toBe('0 phút');
    expect(formatTurnaround(null)).toBe('—');
  });
});

describe('statementStateView', () => {
  it('đã có kết quả xanh, không nhận xám, chờ vàng, quá hạn đỏ', () => {
    expect(statementStateView({ state: 'DONE', late: false })).toEqual({ label: 'Đã có kết quả', tone: 'success' });
    expect(statementStateView({ state: 'DONE', late: true })).toEqual({ label: 'Đã có kết quả', tone: 'success' });
    expect(statementStateView({ state: 'REJECTED', late: false })).toEqual({ label: 'Không nhận', tone: 'neutral' });
    expect(statementStateView({ state: 'WAITING', late: false })).toEqual({ label: 'Chờ kết quả', tone: 'warning' });
    expect(statementStateView({ state: 'WAITING', late: true })).toEqual({ label: 'Quá hạn', tone: 'danger' });
  });
});

describe('statementHasMultipleBranches', () => {
  it('chỉ true khi có từ 2 chi nhánh khác nhau', () => {
    expect(statementHasMultipleBranches([row({ branchName: 'A' }), row({ branchName: 'A' })])).toBe(false);
    expect(statementHasMultipleBranches([row({ branchName: 'A' }), row({ branchName: 'B' })])).toBe(true);
    expect(statementHasMultipleBranches([])).toBe(false);
  });
});

describe('nextDateString', () => {
  it('cộng một ngày, qua tháng/năm/năm nhuận', () => {
    expect(nextDateString('2026-10-31')).toBe('2026-11-01');
    expect(nextDateString('2026-12-31')).toBe('2027-01-01');
    expect(nextDateString('2028-02-28')).toBe('2028-02-29');
    expect(nextDateString('2026-11-06')).toBe('2026-11-07');
  });
});

describe('statementPeriodLabel', () => {
  it('ghi kỳ và mốc tính', () => {
    expect(statementPeriodLabel('2026-11-01', '2026-11-06', 'RECEIVED')).toBe('Từ 01/11/2026 đến 06/11/2026 · Tính theo ngày nhận kết quả');
    expect(statementPeriodLabel('', '', 'SENT')).toBe('Toàn bộ lịch sử · Tính theo ngày gửi');
    expect(statementPeriodLabel('2026-11-01', '', 'SENT')).toBe('Từ 01/11/2026 đến nay · Tính theo ngày gửi');
  });
});

describe('buildLabPartnerStatementPrintSpec', () => {
  it('có đủ cột, dòng cộng chỉ gồm mẫu đã có kết quả, số dư và hai ô ký', () => {
    const spec = buildLabPartnerStatementPrintSpec(data([row({})]), ctx);
    expect(spec.title).toBe('Bảng kê mẫu xét nghiệm gửi đối tác');
    expect(spec.subtitleLines).toEqual(['Đối tác: Phòng xét nghiệm Bình Minh (DT0001)', 'Từ 01/11/2026 đến 06/11/2026 · Tính theo ngày nhận kết quả']);
    expect(spec.infoLines?.[0]).toBe('Số dư đầu kỳ: 0 · Phát sinh trong kỳ: 60.000 · Đã thanh toán trong kỳ: 0 · Số dư cuối kỳ: 60.000');
    expect(spec.signatures).toEqual(['Đại diện phòng khám', 'Đại diện đối tác']);
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).toEqual(['STT', 'Mã ống', 'Bệnh nhân', 'Dịch vụ', 'Gửi lúc', 'Nhận kết quả lúc', 'Thời gian trả', 'Thành tiền (đ)']);
    expect(section.rows[0]).toEqual(['1', '2611050004', 'Bùi Thị Lan Anh (BN2026-004851)', 'HBsAg', '05/11/2026 10:30', '05/11/2026 16:20', '5 giờ 50 phút', '60.000']);
    expect(section.totalRows).toEqual([['Cộng 1 mẫu đã có kết quả', '', '', '', '', '', '', '60.000']]);
    expect(spec.note).toBeUndefined();
  });

  it('mẫu chờ kết quả hiện dự kiến, không nhận hiện 0, có ghi chú tổng; thêm cột chi nhánh khi từ 2 chi nhánh', () => {
    const items = [
      row({}),
      row({ state: 'WAITING', receivedAt: null, turnaroundMinutes: null, amount: 90_000, tubeSid: null, branchName: 'Chi nhánh 2' }),
      row({ state: 'REJECTED', receivedAt: null, turnaroundMinutes: null, amount: 0 }),
    ];
    const spec = buildLabPartnerStatementPrintSpec(data(items, { waitingCount: 1, waitingAmount: 90_000, rejectedCount: 1 }), ctx);
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).toContain('Chi nhánh');
    const waiting = section.rows[1]!;
    expect(waiting).toContain('90.000 (dự kiến)');
    expect(waiting).toContain('Chưa có');
    expect(waiting).toContain('—');
    const rejected = section.rows[2]!;
    expect(rejected).toContain('Đối tác không nhận');
    expect(rejected[rejected.length - 1]).toBe('0');
    expect(spec.note).toContain('Chờ kết quả (chưa tính vào nợ): 1 mẫu, dự kiến 90.000 đ.');
    expect(spec.note).toContain('Đối tác không nhận: 1 mẫu, không tính tiền.');
    expect(section.totalRows?.[0]?.[0]).toBe('Cộng 1 mẫu đã có kết quả');
  });

  it('kỳ rỗng: không có dòng cộng, ghi chú cắt bớt khi bị giới hạn', () => {
    const spec = buildLabPartnerStatementPrintSpec(data([], { doneCount: 0, doneAmount: 0 }, true), ctx);
    expect(spec.sections[0]!.rows).toEqual([]);
    expect(spec.sections[0]!.totalRows).toBeUndefined();
    expect(spec.sections[0]!.emptyText).toBe('Không có mẫu nào trong kỳ.');
    expect(spec.note).toContain('Chỉ in phần đầu của kỳ');
  });
});
