import { describe, expect, it } from 'vitest';
import type { QualityIncompleteReport, QualityInteropReport } from '@nexamed/shared';
import { encounterStatusLabel, formatAttempts, formatDaysOpen, interopStatusLabel, interopStatusToneClass, joinErrors, parseQualityTab } from './quality-model';
import { buildQualityIncompletePrintSpec, buildQualityInteropPrintSpec } from './quality-print-builders';

const id = '00000000-0000-4000-8000-000000000001';
const ctx = { from: '2026-09-01', to: '2026-09-30', scopeLabel: null };

describe('mô hình trang Chất lượng và tuân thủ', () => {
  it('nhãn trạng thái; mã lạ hiện nguyên mã', () => {
    expect(encounterStatusLabel('CHECKED_IN')).toBe('Chờ khám');
    expect(encounterStatusLabel('IN_CONSULTATION')).toBe('Đang khám');
    expect(encounterStatusLabel('KHAC')).toBe('KHAC');
    expect(interopStatusLabel('FAILED')).toBe('Cổng từ chối');
    expect(interopStatusLabel('PENDING')).toBe('Chờ gửi');
    expect(interopStatusLabel('LA')).toBe('LA');
    expect(interopStatusToneClass('FAILED')).toContain('rose');
    expect(interopStatusToneClass('PENDING')).toContain('amber');
  });
  it('định dạng số ngày, số lần thử, lỗi', () => {
    expect(formatDaysOpen(0)).toBe('Hôm nay');
    expect(formatDaysOpen(57)).toBe('57 ngày');
    expect(formatAttempts(0)).toBe('—');
    expect(formatAttempts(3)).toBe('3 lần');
    expect(joinErrors([])).toBe('—');
    expect(joinErrors(['A', 'B'])).toBe('A; B');
  });
  it('chỉ nhận tab có nội dung riêng từ đường dẫn', () => {
    expect(parseQualityTab('interop')).toBe('interop');
    expect(parseQualityTab('audit')).toBe('incomplete');
    expect(parseQualityTab(null)).toBe('incomplete');
  });
});

describe('bản in Chất lượng và tuân thủ', () => {
  it('Lượt khám chưa hoàn tất: mốc đến hôm nay, hai khối, cột chi nhánh chỉ khi nhiều chi nhánh, ghi chú khi bị cắt', () => {
    const report: QualityIncompleteReport = {
      generatedAt: '2026-11-06T08:00:00.000Z',
      asOf: '2026-11-06',
      branchCount: 1,
      summary: { staleEncounters: 250, openShifts: 1, unpaidInvoices: 4, oldestEncounterDays: 57 },
      encounters: [{ encounterId: id, encounterNo: 'LK-1', patientCode: 'BN-1', patientName: 'Nguyễn A', status: 'CHECKED_IN', visitDate: '2026-09-10', daysOpen: 57, doctorName: null, branchName: 'Quận 1' }],
      shifts: [{ shiftId: id, shiftNo: 'CA-1', cashierName: 'Thu ngân A', openedAt: '2026-09-09T23:30:00.000Z', daysOpen: 57, branchName: 'Quận 1' }],
    };
    const spec = buildQualityIncompletePrintSpec(report, ctx);
    expect(spec.title).toBe('Lượt khám chưa hoàn tất');
    expect(spec.subtitleLines).toEqual(['Tình trạng đến hết ngày 06/11/2026']);
    expect(spec.sections.map((s) => s.title)).toEqual(['Lượt khám treo', 'Ca thu ngân chưa đóng']);
    expect(spec.sections[0]!.columns.map((c) => c.header)).toEqual(['Mã lượt khám', 'Bệnh nhân', 'Bác sĩ', 'Tiếp nhận', 'Trạng thái', 'Đã treo']);
    expect(spec.sections[0]!.rows[0]).toEqual(['LK-1', 'Nguyễn A (BN-1)', '—', '10/09/2026', 'Chờ khám', '57 ngày']);
    // 23:30 UTC ngày 09/09 = 06:30 ngày 10/09 giờ Việt Nam.
    expect(spec.sections[1]!.rows[0]).toEqual(['CA-1', 'Thu ngân A', '10/09/2026 06:30', '57 ngày']);
    expect(spec.note).toContain('1 trong 250');
    const multi = buildQualityIncompletePrintSpec({ ...report, branchCount: 2, summary: { ...report.summary, staleEncounters: 1 } }, { ...ctx, scopeLabel: 'Tất cả chi nhánh (2)' });
    expect(multi.sections[0]!.columns.map((c) => c.header)).toContain('Chi nhánh');
    expect(multi.subtitleLines).toEqual(['Tình trạng đến hết ngày 06/11/2026', 'Phạm vi: Tất cả chi nhánh (2)']);
    expect(multi.note).toBeUndefined();
  });

  it('Liên thông: kỳ, tổng quan, theo bác sĩ, đơn tồn kèm lỗi', () => {
    const report: QualityInteropReport = {
      generatedAt: '2026-11-06T08:00:00.000Z',
      from: '2026-09-01',
      to: '2026-09-30',
      branchCount: 1,
      summary: { total: 4, sent: 2, pending: 1, failed: 1, sentPercent: 50, oldestUnsentDays: 55 },
      byDoctor: [{ doctorName: 'BS. Bình', total: 2, sent: 0, pending: 1, failed: 1 }],
      problems: [
        { submissionId: id, encounterId: id, encounterNo: 'LK-2', patientCode: 'BN-2', patientName: 'Trần B', doctorName: 'BS. Bình', nationalCode: '123456789012-C', status: 'FAILED', attempts: 3, lastHttpStatus: 400, errors: ['Mã thuốc không hợp lệ', 'Thiếu tuổi'], signedAt: '2026-09-13T02:30:00.000Z', nextAttemptAt: null, branchName: 'Quận 1' },
      ],
      problemTotal: 2,
    };
    const spec = buildQualityInteropPrintSpec(report, ctx);
    expect(spec.title).toBe('Liên thông đơn thuốc');
    expect(spec.subtitleLines).toEqual(['Từ 01/09/2026 đến 30/09/2026']);
    expect(spec.infoLines![0]).toContain('Đã gửi: 2 (50%)');
    expect(spec.sections[0]!.rows[0]).toEqual(['BS. Bình', '2', '0', '1', '1']);
    expect(spec.sections[0]!.totalRows![0]).toEqual(['Cộng', '4', '2', '1', '1']);
    expect(spec.sections[1]!.rows[0]).toEqual(['LK-2', 'Trần B (BN-2)', 'BS. Bình', '13/09/2026 09:30', 'Cổng từ chối', '3 lần', 'Mã thuốc không hợp lệ; Thiếu tuổi']);
    expect(spec.note).toContain('1 trong 2');
  });
});
