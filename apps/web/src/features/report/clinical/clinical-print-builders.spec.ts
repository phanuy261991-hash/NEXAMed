import { describe, expect, it } from 'vitest';
import type { ClinicalDiagnosisReport, ClinicalParaclinicalReport } from '@nexamed/shared';
import { formatDuration, formatWait, kindLabel, parseClinicalTab } from './clinical-model';
import { buildClinicalDiagnosisPrintSpec, buildClinicalParaclinicalPrintSpec } from './clinical-print-builders';

const header = { generatedAt: '2026-11-06T08:00:00.000Z', from: '2026-09-01', to: '2026-09-30', branchCount: 1 };
const ctx = { from: '2026-09-01', to: '2026-09-30', scopeLabel: null };
const id = '00000000-0000-4000-8000-000000000001';

describe('mô hình trang Chuyên môn', () => {
  it('định dạng thời gian và nhãn nhóm dịch vụ; nhóm lạ hiện nguyên mã', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45)).toBe('45 phút');
    expect(formatDuration(125)).toBe('2 giờ 05 phút');
    expect(formatDuration(120)).toBe('2 giờ');
    expect(formatWait(90)).toBe('1 giờ 30 phút');
    expect(formatWait(3 * 24 * 60 + 4 * 60)).toBe('3 ngày 4 giờ');
    expect(formatWait(2 * 24 * 60)).toBe('2 ngày');
    expect(kindLabel('LAB')).toBe('Xét nghiệm');
    expect(kindLabel('MOI')).toBe('MOI');
  });
  it('chỉ nhận tab có nội dung riêng từ đường dẫn; tab dẫn sang trang khác hay mã lạ rơi về tab đầu', () => {
    expect(parseClinicalTab('paraclinical')).toBe('paraclinical');
    expect(parseClinicalTab('services')).toBe('diagnoses');
    expect(parseClinicalTab('xyz')).toBe('diagnoses');
    expect(parseClinicalTab(null)).toBe('diagnoses');
  });
});

describe('bản in Chuyên môn', () => {
  it('Chẩn đoán: tiêu đề, kỳ, bảng bệnh hay gặp, theo chương', () => {
    const report: ClinicalDiagnosisReport = {
      ...header,
      summary: { completedVisits: 12, withDiagnosis: 10, withoutDiagnosis: 2, distinctCodes: 3, topCode: 'A09', topCodeName: 'Tiêu chảy' },
      rows: [{ code: 'A09', name: 'Tiêu chảy', visits: 5, patients: 4, percent: 50 }],
      chapters: [{ chapterCode: 'I', chapterName: 'Bệnh nhiễm trùng', visits: 5, percent: 50 }],
    };
    const spec = buildClinicalDiagnosisPrintSpec(report, { ...ctx, scopeLabel: 'Tất cả chi nhánh (3)' });
    expect(spec.title).toBe('Cơ cấu chẩn đoán ICD-10');
    expect(spec.subtitleLines).toEqual(['Từ 01/09/2026 đến 30/09/2026', 'Phạm vi: Tất cả chi nhánh (3)']);
    expect(spec.sections.map((s) => s.title)).toEqual(['Bệnh hay gặp', 'Theo chương ICD-10']);
    expect(spec.sections[0]!.rows[0]).toEqual(['1', 'A09', 'Tiêu chảy', '5', '4', '50%']);
    expect(spec.sections[1]!.rows[0]).toEqual(['I', 'Bệnh nhiễm trùng', '5', '50%']);
    expect(spec.infoLines![0]).toContain('Chưa có chẩn đoán: 2');
  });

  it('Cận lâm sàng: nhóm dịch vụ, dòng cộng, cột chi nhánh chỉ khi nhiều chi nhánh, ghi chú khi bị cắt', () => {
    const overdue = { orderItemId: id, encounterId: id, patientCode: 'BN-1', patientName: 'Nguyễn A', serviceName: 'Công thức máu', kind: 'LAB' as const, branchName: 'Quận 1', orderedAt: '2026-09-10T02:05:00.000Z', turnaroundMinutes: 60, waitedMinutes: 3 * 24 * 60 };
    const base: ClinicalParaclinicalReport = {
      ...header,
      summary: { ordered: 6, inHouse: 5, external: 1, completed: 3, pending: 2, avgMinutes: 52, overdue: 2, overdueOpen: 5, lateCompleted: 1 },
      byKind: [{ kind: 'LAB', ordered: 3, inHouse: 3, external: 0, completed: 2, avgMinutes: 68, overdue: 2 }],
      topServices: [{ name: 'Công thức máu', kind: 'LAB', ordered: 3, completed: 2, avgMinutes: 68, overdue: 2 }],
      overdueItems: [overdue],
    };
    const one = buildClinicalParaclinicalPrintSpec(base, ctx);
    expect(one.sections[0]!.rows[0]).toEqual(['Xét nghiệm', '3', '3', '0', '2', '1 giờ 08 phút', '2']);
    expect(one.sections[0]!.totalRows![0]).toEqual(['Cộng', '6', '5', '1', '3', '52 phút', '2']);
    expect(one.sections[1]!.rows[0]).toEqual(['1', 'Công thức máu', 'Xét nghiệm', '3', '2', '1 giờ 08 phút', '2']);
    expect(one.sections[2]!.columns.map((c) => c.header)).toEqual(['Mã BN', 'Bệnh nhân', 'Dịch vụ', 'Chỉ định lúc', 'Hạn trả', 'Đã chờ']);
    expect(one.sections[2]!.rows[0]).toEqual(['BN-1', 'Nguyễn A', 'Công thức máu', '10/09/2026 09:05', '1 giờ', '3 ngày']);
    expect(one.note).toContain('1 trong 5');
    const many = buildClinicalParaclinicalPrintSpec({ ...base, branchCount: 2, summary: { ...base.summary, overdueOpen: 1 } }, ctx);
    expect(many.sections[2]!.columns.map((c) => c.header)).toContain('Chi nhánh');
    expect(many.note).toBeUndefined();
  });
});
