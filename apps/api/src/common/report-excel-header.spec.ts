import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { addReportExcelHeader, formatReportDate, formatReportDateTime, formatReportPeriod } from './report-excel-header';

const base = { clinicName: 'Phòng khám Sao Mai', title: 'Báo cáo ngày', from: '2026-11-03', to: '2026-11-03', exportedByName: 'Nguyễn Văn A', exportedAt: new Date('2026-11-03T16:45:00.000Z') };

describe('đầu báo cáo Excel dùng chung', () => {
  it('ghi đủ dòng: tên phòng khám, tên báo cáo (HOA), kỳ, người xuất + giờ VN; trả số dòng đã dùng', () => {
    const sheet = new ExcelJS.Workbook().addWorksheet('t');
    const used = addReportExcelHeader(sheet, base);
    expect(used).toBe(5);
    expect(sheet.getCell('A1').value).toBe('Phòng khám Sao Mai');
    expect(sheet.getCell('A2').value).toBe('BÁO CÁO NGÀY');
    expect(sheet.getCell('A3').value).toBe('Ngày 03/11/2026');
    // 16:45 UTC = 23:45 giờ VN cùng ngày
    expect(sheet.getCell('A4').value).toBe('Người xuất: Nguyễn Văn A · Lúc: 03/11/2026 23:45');
    expect(sheet.getCell('A5').value).toBeNull(); // dòng trống ngăn cách
    expect(sheet.rowCount).toBe(5);
  });

  it('có chi nhánh và phạm vi thì thêm vào đầu; kỳ nhiều ngày ghi "Từ … đến …"', () => {
    const sheet = new ExcelJS.Workbook().addWorksheet('t');
    const used = addReportExcelHeader(sheet, { ...base, branchName: 'Chi nhánh Quận 1', scopeLabel: 'Tất cả chi nhánh', from: '2026-11-01', to: '2026-11-30' });
    expect(used).toBe(6);
    expect(sheet.getCell('A1').value).toBe('Phòng khám Sao Mai — Chi nhánh Quận 1');
    expect(sheet.getCell('A3').value).toBe('Từ 01/11/2026 đến 30/11/2026');
    expect(sheet.getCell('A4').value).toBe('Phạm vi: Tất cả chi nhánh');
  });

  it('giờ xuất lúc 17:30 UTC là 00:30 NGÀY HÔM SAU theo giờ Việt Nam', () => {
    expect(formatReportDateTime(new Date('2026-11-03T17:30:00.000Z'))).toBe('04/11/2026 00:30');
    expect(formatReportDate('2026-01-05')).toBe('05/01/2026');
    expect(formatReportPeriod('2026-01-05', '2026-01-05')).toBe('Ngày 05/01/2026');
  });
});
