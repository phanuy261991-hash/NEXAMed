import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import type {
  ImportWorkShiftAssignmentRowError,
  ImportWorkShiftAssignmentValidRow,
  ImportWorkShiftAssignmentsCommitResponse,
  ImportWorkShiftAssignmentsPreviewResponse,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { UserAccountRepository } from '../iam/user-account.repository';
import { WorkShiftService } from '../clinic/work-shift.service';
import { WorkShiftAssignmentRepository } from './work-shift-assignment.repository';

const WEEKDAY_ABBR = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

interface ResolvedCell {
  rowNumber: number;
  userId: string;
  employeeName: string;
  workDate: string;
  workShiftId: string;
  workShiftName: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Số ngày của `month` (`YYYY-MM`) — mẹo "ngày 0 của tháng kế tiếp", cùng kỹ thuật `MyWorkSchedulePage.tsx`. */
function daysInMonth(month: string): number {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, m ?? 1, 0)).getUTCDate();
}

function weekdayAbbrOf(month: string, day: number): string {
  const [year, m] = month.split('-').map(Number);
  return WEEKDAY_ABBR[new Date(Date.UTC(year ?? 1970, (m ?? 1) - 1, day)).getUTCDay()]!;
}

function cellToText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  return String(cell.text ?? '').trim();
}

/**
 * Nhập/Xuất Excel "Lịch làm việc nhân viên" (chỉ scope `global`, gọi từ Controller sau khi đã kiểm
 * `dataScope==='global'`). File dạng BẢNG NGANG theo THÁNG — cột 1 = Mã nhân viên, cột 2..N = từng
 * ngày trong tháng (vị trí cột quyết định ngày, KHÔNG đọc tiêu đề cột — header chỉ để người dùng
 * đọc bằng mắt), ô giao = Mã ca (nhiều ca/ngày cách nhau dấu phẩy). `month` luôn là tham số riêng
 * do người dùng chọn ở UI (xem `work-shift-assignment.ts` ở `packages/shared`), validate cùng logic
 * cho cả preview (chỉ đọc) và commit (đọc lại đúng file + `month` rồi mới ghi).
 */
@Injectable()
export class WorkShiftAssignmentImportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly userAccountRepository: UserAccountRepository,
    private readonly workShiftService: WorkShiftService,
    private readonly repository: WorkShiftAssignmentRepository,
  ) {}

  async buildTemplate(month: string): Promise<Buffer> {
    const dayCount = daysInMonth(month);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Lịch làm việc');

    const headerRow = ['Mã nhân viên', ...Array.from({ length: dayCount }, (_, i) => `${i + 1} (${weekdayAbbrOf(month, i + 1)})`)];
    sheet.addRow([`Tháng: ${month} — chỉ để đối chiếu, KHÔNG đọc tự động. Hệ thống nhập theo tháng đã chọn ở màn hình lúc nhập.`]);
    sheet.mergeCells(1, 1, 1, headerRow.length);
    sheet.getRow(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
    sheet.addRow(headerRow);
    sheet.getRow(2).font = { bold: true };
    sheet.getColumn(1).width = 18;
    for (let i = 2; i <= headerRow.length; i++) sheet.getColumn(i).width = 9;
    for (let i = 1; i <= headerRow.length; i++) sheet.getColumn(i).numFmt = '@';

    const exampleRow = ['NV2608000001', ...Array.from({ length: dayCount }, (_, i) => (i === 0 ? 'WO-XXXXXXXX' : ''))];
    sheet.addRow(exampleRow);
    sheet.getRow(3).font = { italic: true, color: { argb: 'FF94A3B8' } };

    const noteSheet = workbook.addWorksheet('Hướng dẫn');
    noteSheet.columns = [{ width: 95 }];
    noteSheet.addRows([
      ['Mỗi dòng ở sheet "Lịch làm việc" là 1 nhân viên; mỗi cột (từ cột thứ 2) là 1 ngày trong tháng đã chọn.'],
      ['Gõ Mã ca vào đúng ô giao giữa dòng nhân viên và cột ngày cần đăng ký. Để trống nếu không có ca hôm đó.'],
      ['1 ngày có nhiều ca thì gõ nhiều Mã ca cách nhau bằng dấu phẩy, ví dụ: WO-AAAAAAA,WO-BBBBBBB'],
      ['Mã nhân viên: lấy ở trang Danh mục Tổ chức và Nhân sự → Quản lý tài khoản.'],
      ['Mã ca: lấy ở Cấu hình hệ thống → Cấu hình phòng khám → Ca làm việc.'],
      [`File này dành riêng cho tháng ${month} (${dayCount} ngày) — lúc nhập lên hệ thống, nhớ chọn đúng tháng này ở màn hình Nhập Excel.`],
      ['Xoá dòng ví dụ (dòng 3) trước khi nhập dữ liệu thật.'],
    ]);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async buildExport(tenantId: string, month: string): Promise<Buffer> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const dayCount = daysInMonth(month);
      const from = `${month}-01`;
      const to = `${month}-${pad2(dayCount)}`;
      const rows = await this.repository.list(tx, tenantId, { from, to });
      const users = await this.userAccountRepository.list(tx, tenantId, { take: 1000 });
      const userById = new Map(users.map((u) => [u.id, u]));

      const byUserDay = new Map<string, string[]>();
      for (const row of rows) {
        const day = row.workDate.getUTCDate();
        const key = `${row.userId}|${day}`;
        const list = byUserDay.get(key) ?? [];
        list.push(row.workShift.code);
        byUserDay.set(key, list);
      }
      const userIdsWithData = [...new Set(rows.map((r) => r.userId))];

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Lịch làm việc');
      const headerRow = ['Mã nhân viên', ...Array.from({ length: dayCount }, (_, i) => `${i + 1} (${weekdayAbbrOf(month, i + 1)})`)];
      sheet.addRow([`Tháng: ${month}`]);
      sheet.mergeCells(1, 1, 1, headerRow.length);
      sheet.getRow(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
      sheet.addRow(headerRow);
      sheet.getRow(2).font = { bold: true };
      sheet.getColumn(1).width = 18;
      for (let i = 2; i <= headerRow.length; i++) sheet.getColumn(i).width = 9;
      for (let i = 1; i <= headerRow.length; i++) sheet.getColumn(i).numFmt = '@';

      for (const userId of userIdsWithData) {
        const user = userById.get(userId);
        const dataRow = [user?.employeeCode ?? userId, ...Array.from({ length: dayCount }, (_, i) => (byUserDay.get(`${userId}|${i + 1}`) ?? []).join(','))];
        sheet.addRow(dataRow);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    });
  }

  async preview(tenantId: string, month: string, fileBuffer: Buffer): Promise<ImportWorkShiftAssignmentsPreviewResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const { validCells, duplicateCells, errorCells } = await this.parseAndResolve(tx, tenantId, month, fileBuffer);
      return {
        validRows: validCells.map(toValidRowDto),
        duplicateRows: duplicateCells.map(toValidRowDto),
        errorRows: errorCells,
      };
    });
  }

  async commit(tenantId: string, actorId: string, month: string, fileBuffer: Buffer): Promise<ImportWorkShiftAssignmentsCommitResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const { validCells, duplicateCells, errorCells } = await this.parseAndResolve(tx, tenantId, month, fileBuffer);

      const createdCount = await this.repository.createManySkipDuplicates(
        tx,
        validCells.map((r) => ({
          tenantId,
          userId: r.userId,
          workShiftId: r.workShiftId,
          workDate: new Date(`${r.workDate}T00:00:00.000Z`),
          createdBy: actorId,
          updatedBy: actorId,
        })),
      );

      return { createdCount, duplicateCount: duplicateCells.length, errorCount: errorCells.length };
    });
  }

  private async parseAndResolve(
    tx: Prisma.TransactionClient,
    tenantId: string,
    month: string,
    fileBuffer: Buffer,
  ): Promise<{ validCells: ResolvedCell[]; duplicateCells: ResolvedCell[]; errorCells: ImportWorkShiftAssignmentRowError[] }> {
    const dayCount = daysInMonth(month);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];

    type RawCell = { rowNumber: number; employeeCode: string; day: number; workShiftCode: string };
    const rawCells: RawCell[] = [];
    // Dòng 1 = ghi chú tháng, dòng 2 = tiêu đề — dữ liệu bắt đầu từ dòng 3 (đúng khuôn `buildTemplate`).
    sheet?.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= 2) return;
      const employeeCode = cellToText(row.getCell(1));
      if (!employeeCode) return; // dòng trống hoàn toàn
      for (let day = 1; day <= dayCount; day++) {
        const raw = cellToText(row.getCell(1 + day));
        if (!raw) continue;
        for (const workShiftCode of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
          rawCells.push({ rowNumber, employeeCode, day, workShiftCode });
        }
      }
    });

    const employeeCodes = [...new Set(rawCells.map((r) => r.employeeCode))];
    const users = await this.userAccountRepository.findActiveByEmployeeCodes(tx, tenantId, employeeCodes);
    const userByCode = new Map(users.map((u) => [u.employeeCode!, u]));

    const { items: workShifts } = await this.workShiftService.list(tenantId);
    const shiftByCode = new Map(workShifts.filter((s) => s.isActive).map((s) => [s.code, s]));

    const from = `${month}-01`;
    const to = `${month}-${pad2(dayCount)}`;
    const existing = rawCells.length > 0 ? await this.repository.list(tx, tenantId, { from, to }) : [];
    const existingKeys = new Set(existing.map((e) => `${e.userId}|${e.workDate.toISOString().slice(0, 10)}|${e.workShiftId}`));
    const seenInFile = new Set<string>();

    const validCells: ResolvedCell[] = [];
    const duplicateCells: ResolvedCell[] = [];
    const errorCells: ImportWorkShiftAssignmentRowError[] = [];

    for (const raw of rawCells) {
      const workDate = `${month}-${pad2(raw.day)}`;
      const user = userByCode.get(raw.employeeCode);
      if (!user) {
        errorCells.push({ rowNumber: raw.rowNumber, employeeCode: raw.employeeCode, workDate, workShiftCode: raw.workShiftCode, reason: 'Mã nhân viên không tồn tại hoặc đã nghỉ việc.' });
        continue;
      }
      const shift = shiftByCode.get(raw.workShiftCode);
      if (!shift) {
        errorCells.push({ rowNumber: raw.rowNumber, employeeCode: raw.employeeCode, workDate, workShiftCode: raw.workShiftCode, reason: 'Mã ca không tồn tại hoặc đã ngừng dùng.' });
        continue;
      }

      const resolved: ResolvedCell = {
        rowNumber: raw.rowNumber,
        userId: user.id,
        employeeName: user.displayName ?? user.fullName,
        workDate,
        workShiftId: shift.id,
        workShiftName: shift.name,
      };
      const key = `${user.id}|${workDate}|${shift.id}`;
      if (existingKeys.has(key) || seenInFile.has(key)) {
        duplicateCells.push(resolved);
        continue;
      }
      seenInFile.add(key);
      validCells.push(resolved);
    }

    return { validCells, duplicateCells, errorCells };
  }
}

function toValidRowDto(r: ResolvedCell): ImportWorkShiftAssignmentValidRow {
  return { rowNumber: r.rowNumber, employeeName: r.employeeName, workDate: r.workDate, workShiftName: r.workShiftName };
}
