import { describe, expect, it } from 'vitest';
import type { PatientDemographicsReport, PatientNewReturningReport, PatientNotReturningReport } from '@nexamed/shared';
import { formatDecimal, formatMonth, patientProfileLink, reminderLabel, reminderToneClass, shareOf } from './patients-model';
import { buildPatientDemographicsPrintSpec, buildPatientNewReturningPrintSpec, buildPatientNotReturningPrintSpec } from './patients-print-builders';

const header = { generatedAt: '2026-11-06T08:00:00.000Z', from: '2026-09-01', to: '2026-09-30', branchCount: 1 };
const ctx = { from: '2026-09-01', to: '2026-09-30', scopeLabel: null };
const id = '00000000-0000-4000-8000-000000000001';

describe('mô hình trang Bệnh nhân', () => {
  it('định dạng tháng, tỉ lệ, số thập phân', () => {
    expect(formatMonth('2026-09')).toBe('09/2026');
    expect(formatMonth('abc')).toBe('abc');
    expect(shareOf(1, 3)).toBe(33.3);
    expect(shareOf(1, 0)).toBeNull();
    expect(formatDecimal(1.5)).toBe('1,5');
    expect(formatDecimal(null)).toBe('—');
  });
  it('nhãn kết quả nhắc: mã lạ hiện nguyên mã, chưa nhắc có màu cảnh báo', () => {
    expect(reminderLabel(null)).toBe('Chưa nhắc');
    expect(reminderLabel('NOT_RETURNING')).toBe('Bệnh nhân không tái khám');
    expect(reminderLabel('KHAC')).toBe('KHAC');
    expect(reminderToneClass(null)).toContain('amber');
    expect(patientProfileLink(id)).toBe(`/patients/${id}`);
  });
});

describe('bản in Bệnh nhân', () => {
  it('Mới và cũ: tiêu đề, kỳ, phạm vi, ba khối và tỉ lệ', () => {
    const report: PatientNewReturningReport = {
      ...header,
      summary: { patients: 6, newPatients: 2, returningPatients: 4, visits: 9, visitsPerPatient: 1.5, returningPercent: 66.7 },
      frequency: [
        { key: '1', label: '1 lượt', patients: 4 },
        { key: '2', label: '2 lượt', patients: 2 },
      ],
      gap: [{ key: '0', label: 'Trong 30 ngày', patients: 3 }],
      byMonth: [{ month: '2026-09', patients: 6, newPatients: 2, returningPatients: 4, visits: 9 }],
    };
    const spec = buildPatientNewReturningPrintSpec(report, { ...ctx, scopeLabel: 'Tất cả chi nhánh (3)' });
    expect(spec.title).toBe('Bệnh nhân mới và cũ');
    expect(spec.subtitleLines).toEqual(['Từ 01/09/2026 đến 30/09/2026', 'Phạm vi: Tất cả chi nhánh (3)']);
    expect(spec.sections.map((s) => s.title)).toEqual(['Theo tháng', 'Số lượt khám của mỗi bệnh nhân trong kỳ', 'Bệnh nhân cũ: quay lại sau']);
    expect(spec.sections[0]!.rows[0]).toEqual(['09/2026', '6', '2', '4', '9']);
    expect(spec.sections[1]!.rows[0]).toEqual(['1 lượt', '4', '66,7%']);
    expect(spec.sections[2]!.rows[0]).toEqual(['Trong 30 ngày', '3', '75%']);
    expect(spec.infoLines![0]).toContain('Lượt mỗi bệnh nhân: 1,5');
  });

  it('Tuổi giới địa bàn: dòng cộng, ghi chú tuổi thiếu và tỉnh chưa ghi', () => {
    const band = (key: string, label: string, male: number, female: number) => ({ key, label, male, female, other: 0, total: male + female });
    const report: PatientDemographicsReport = {
      ...header,
      patients: 10,
      genders: { male: 4, female: 5, other: 1 },
      ageBands: [band('1-5', '1–5 tuổi', 3, 2), band('31-45', '31–45 tuổi', 1, 3)],
      unknownAge: 1,
      provinces: [{ code: 'P1', name: 'Tỉnh A', provinceName: '', patients: 6 }],
      wards: [{ code: 'W1', name: 'Phường 1', provinceName: 'Tỉnh A', patients: 4 }],
      unknownProvince: 4,
    };
    const spec = buildPatientDemographicsPrintSpec(report, ctx);
    expect(spec.sections[0]!.rows[0]).toEqual(['1–5 tuổi', '3', '2', '0', '5', '50%']);
    expect(spec.sections[0]!.totalRows).toEqual([
      ['Cộng', '4', '5', '0', '9', ''],
      ['Chưa có ngày sinh hợp lệ', '', '', '', '1', ''],
    ]);
    expect(spec.sections[1]!.totalRows![0]).toEqual(['Chưa ghi tỉnh/thành', '4', '40%']);
    expect(spec.sections[2]!.rows[0]).toEqual(['Phường 1', 'Tỉnh A', '4']);
  });

  it('Không quay lại: cột chi nhánh chỉ khi nhiều chi nhánh; ghi chú khi danh sách bị cắt', () => {
    const item = {
      patientId: id,
      patientCode: 'BN-1',
      patientName: 'Nguyễn A',
      phone: '0901234567',
      encounterId: id,
      visitDate: '2026-09-12',
      dueDate: '2026-09-20',
      overdueDays: 47,
      doctorName: null,
      branchName: 'Quận 1',
      reminderCount: 2,
      lastReminderResult: 'REACHED',
    };
    const base: PatientNotReturningReport = { ...header, summary: { patients: 600, reminded: 1, markedNotReturning: 0, avgOverdueDays: 47 }, items: [item], totalCount: 600 };
    const one = buildPatientNotReturningPrintSpec(base, ctx);
    expect(one.sections[0]!.columns.map((c) => c.header)).toEqual(['Mã BN', 'Bệnh nhân', 'Điện thoại', 'Ngày khám', 'Ngày hẹn', 'Quá hạn', 'Nhắc']);
    expect(one.sections[0]!.rows[0]).toEqual(['BN-1', 'Nguyễn A', '0901234567', '12/09/2026', '20/09/2026', '47 ngày', '2 lần · Đã liên lạc được']);
    expect(one.note).toContain('1 trong 600');
    const many = buildPatientNotReturningPrintSpec({ ...base, branchCount: 2, totalCount: 1, items: [{ ...item, reminderCount: 0, lastReminderResult: null }] }, ctx);
    expect(many.sections[0]!.columns.map((c) => c.header)).toContain('Chi nhánh');
    expect(many.sections[0]!.rows[0]).toContain('Chưa nhắc');
    expect(many.note).toBeUndefined();
  });
});
