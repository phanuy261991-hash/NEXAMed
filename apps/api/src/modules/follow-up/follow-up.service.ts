import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  CLINIC_CONFIG_READER_PORT,
  DOCTOR_DIRECTORY_PORT,
  FOLLOW_UP_OVERDUE_DAYS,
  FollowUpDisabledError,
  FOLLOW_UP_UPCOMING_DAYS,
  addDaysToDateString,
  classifyFollowUp,
  getVietnamDateString,
  stripVietnameseDiacritics,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import {
  FOLLOW_UP_REMINDER_RESULT_LABEL,
  FOLLOW_UP_STATUS_LABEL,
  type CreateFollowUpReminderRequest,
  type DataScope,
  type FollowUpItem,
  type ListFollowUpRemindersResponse,
  type ListFollowUpsQuery,
  type ListFollowUpsResponse,
} from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { addReportExcelHeader, formatReportDate, formatReportDateTime } from '../../common/report-excel-header';
import type { RequestMeta } from '../../common/request-meta';
import { findAllPermissionsForUser } from '../../infrastructure/persistence/permission-lookup.helper';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { FollowUpRepository, type FollowUpCursor, type FollowUpFilter, type FollowUpRow } from './follow-up.repository';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/** Số dòng tối đa của một bản Excel (bảo vệ máy chủ; danh sách dài hơn thì lọc bớt). */
const EXPORT_ROW_LIMIT = 5000;

function encodeCursor(row: Pick<FollowUpRow, 'followUpDate' | 'encounterId'>): string {
  return Buffer.from(JSON.stringify({ d: row.followUpDate, i: row.encounterId }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): FollowUpCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { d?: unknown; i?: unknown };
    if (typeof parsed.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.d) && typeof parsed.i === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.i)) return { date: parsed.d, id: parsed.i };
  } catch {
    // rơi xuống lỗi chung bên dưới
  }
  throw new BadRequestException('Con trỏ phân trang không hợp lệ.');
}

/**
 * Trang "Hẹn tái khám" (docs/DECISIONS.md #285): danh sách hẹn tái khám của chi nhánh đang làm việc kèm nhật ký nhắc. Bác sĩ (phạm vi `personal`) chỉ thấy hẹn của lượt khám do mình khám.
 * Chẩn đoán chính CHỈ gửi khi actor có `encounter.read_clinical` (lễ tân không có quyền xem nội dung lâm sàng). Một request = MỘT transaction; đọc port (tên người xuất, tên phòng khám) TRƯỚC transaction.
 */
@Injectable()
export class FollowUpService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: FollowUpRepository,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfig: ClinicConfigReaderPort,
  ) {}

  /** Công tắc "Dùng Hẹn tái khám" tắt thì từ chối (409). Đọc port TRƯỚC khi mở transaction (một request = MỘT transaction). */
  private async assertEnabled(tenantId: string): Promise<void> {
    if (!(await this.clinicConfig.getFollowUpEnabled(tenantId))) throw new FollowUpDisabledError();
  }

  private buildFilter(actor: Actor, dataScope: DataScope, query: Pick<ListFollowUpsQuery, 'q' | 'doctorId'>, today: string): FollowUpFilter {
    const normalized = query.q ? stripVietnameseDiacritics(query.q).toLowerCase().trim() : '';
    return {
      tenantId: actor.tenantId,
      branchId: requireBranchId(actor),
      onlyDoctorId: dataScope === 'personal' ? actor.userId : null,
      searchNormalized: normalized === '' ? null : normalized,
      doctorId: query.doctorId ?? null,
      today,
      overdueFrom: addDaysToDateString(today, -FOLLOW_UP_OVERDUE_DAYS)!,
      upcomingTo: addDaysToDateString(today, FOLLOW_UP_UPCOMING_DAYS)!,
    };
  }

  async list(actor: Actor, dataScope: DataScope, query: ListFollowUpsQuery, now: Date = new Date()): Promise<ListFollowUpsResponse> {
    await this.assertEnabled(actor.tenantId);
    const today = getVietnamDateString(now);
    const filter = this.buildFilter(actor, dataScope, query, today);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    return this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const permissions = await findAllPermissionsForUser(tx, actor.tenantId, actor.userId);
      const [counts, rows] = await Promise.all([this.repository.countTabs(tx, filter), this.repository.list(tx, filter, query.tab, cursor, query.limit)]);
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const items = await this.toItems(tx, actor.tenantId, page, today, 'encounter.read_clinical' in permissions);
      return { items, nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null, counts };
    });
  }

  private async toItems(tx: Parameters<FollowUpRepository['doctorNames']>[0], tenantId: string, rows: readonly FollowUpRow[], today: string, canViewClinical: boolean): Promise<FollowUpItem[]> {
    const encounterIds = rows.map((r) => r.encounterId);
    const doctorIds = [...new Set(rows.map((r) => r.doctorId).filter((id): id is string => id !== null))];
    const [doctorNames, stats, diagnoses] = await Promise.all([
      this.repository.doctorNames(tx, tenantId, doctorIds),
      this.repository.reminderStats(tx, tenantId, encounterIds),
      canViewClinical ? this.repository.primaryDiagnosisNames(tx, tenantId, encounterIds) : Promise.resolve(new Map<string, string>()),
    ]);
    return rows.map((r) => {
      const s = stats.get(r.encounterId);
      return {
        encounterId: r.encounterId,
        encounterNo: r.encounterNo,
        patientId: r.patientId,
        patientCode: r.patientCode,
        patientName: r.patientName,
        phone: r.phone,
        followUpDate: r.followUpDate,
        status: classifyFollowUp(r.followUpDate, today, r.returned),
        sourceDate: r.sourceDate,
        doctorId: r.doctorId,
        doctorName: r.doctorId ? (doctorNames.get(r.doctorId) ?? null) : null,
        diagnosisName: canViewClinical ? (diagnoses.get(r.encounterId) ?? null) : null,
        reminderCount: s?.count ?? 0,
        lastReminder: s?.last ? { remindedAt: s.last.remindedAt.toISOString(), result: s.last.result, byName: s.last.byName } : null,
      };
    });
  }

  async listReminders(actor: Actor, dataScope: DataScope, encounterId: string): Promise<ListFollowUpRemindersResponse> {
    await this.assertEnabled(actor.tenantId);
    const branchId = requireBranchId(actor);
    return this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      if (!(await this.repository.hasFollowUp(tx, actor.tenantId, branchId, encounterId, dataScope === 'personal' ? actor.userId : null))) throw new NotFoundException();
      const rows = await this.repository.listReminders(tx, actor.tenantId, encounterId);
      return { items: rows.map((r) => ({ id: r.id, result: r.result, note: r.note, remindedAt: r.remindedAt.toISOString(), byName: r.byName })) };
    });
  }

  /** Ghi một lần nhắc. Thời điểm do máy chủ đặt, người ghi là actor. Audit ghi mã lượt khám + kết quả, KHÔNG ghi ghi chú (có thể chứa thông tin cá nhân). */
  async createReminder(actor: Actor, dataScope: DataScope, encounterId: string, dto: CreateFollowUpReminderRequest, meta: RequestMeta) {
    await this.assertEnabled(actor.tenantId);
    const branchId = requireBranchId(actor);
    return this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      if (!(await this.repository.hasFollowUp(tx, actor.tenantId, branchId, encounterId, dataScope === 'personal' ? actor.userId : null))) throw new NotFoundException();
      const created = await this.repository.createReminder(tx, actor.tenantId, actor.userId, { encounterId, result: dto.result, note: dto.note && dto.note !== '' ? dto.note : null });
      await writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'follow_up_reminder.created',
        entityType: 'follow_up_reminder',
        entityId: created.id,
        afterJson: { encounterId, result: dto.result },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { id: created.id, remindedAt: created.remindedAt.toISOString() };
    });
  }

  /** Bản Excel đúng bộ lọc đang xem (tab, tìm kiếm, bác sĩ), tối đa `EXPORT_ROW_LIMIT` dòng. */
  async exportExcel(actor: Actor, dataScope: DataScope, query: Omit<ListFollowUpsQuery, 'cursor' | 'limit'>, now: Date = new Date()): Promise<Buffer> {
    await this.assertEnabled(actor.tenantId);
    const today = getVietnamDateString(now);
    const branchId = requireBranchId(actor);
    const filter = this.buildFilter(actor, dataScope, query, today);
    // Tên phòng khám/người xuất đọc qua service/port TRƯỚC transaction chính (một request = MỘT transaction).
    const [header, names] = await Promise.all([this.clinicProfileService.getPrintHeader(actor.tenantId, branchId), this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId])]);
    const items = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      const permissions = await findAllPermissionsForUser(tx, actor.tenantId, actor.userId);
      const rows = await this.repository.list(tx, filter, query.tab, null, EXPORT_ROW_LIMIT);
      return this.toItems(tx, actor.tenantId, rows.slice(0, EXPORT_ROW_LIMIT), today, 'encounter.read_clinical' in permissions);
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Hẹn tái khám');
    const tabTitle = { today: 'hôm nay', overdue: 'quá hạn', upcoming: 'sắp tới', all: 'tất cả' }[query.tab];
    const used = addReportExcelHeader(sheet, {
      clinicName: header.name,
      branchName: header.branchName ?? null,
      title: `Danh sách hẹn tái khám — ${tabTitle}`,
      from: today,
      to: today,
      exportedByName: names.get(actor.userId) ?? 'Không rõ',
      exportedAt: now,
    });
    sheet.getRow(used + 1).values = ['Ngày hẹn', 'Trạng thái', 'Mã BN', 'Bệnh nhân', 'Số điện thoại', 'Ngày khám gốc', 'Bác sĩ', 'Chẩn đoán', 'Số lần nhắc', 'Lần nhắc gần nhất'];
    sheet.getRow(used + 1).font = { bold: true };
    for (const it of items) {
      const last = it.lastReminder ? `${formatReportDateTime(new Date(it.lastReminder.remindedAt))} · ${FOLLOW_UP_REMINDER_RESULT_LABEL[it.lastReminder.result]} · ${it.lastReminder.byName}` : '';
      sheet.addRow([formatReportDate(it.followUpDate), FOLLOW_UP_STATUS_LABEL[it.status], it.patientCode, it.patientName, it.phone, formatReportDate(it.sourceDate), it.doctorName ?? '', it.diagnosisName ?? '', it.reminderCount, last]);
    }
    sheet.columns = [{ width: 14 }, { width: 14 }, { width: 14 }, { width: 28 }, { width: 16 }, { width: 16 }, { width: 24 }, { width: 30 }, { width: 12 }, { width: 50 }];
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Ghi nhật ký xuất Excel (ai xuất, bộ lọc nào) — số điện thoại và tên bệnh nhân rời khỏi hệ thống nên phải có dấu vết. */
  async recordExportAudit(actor: Actor, query: Omit<ListFollowUpsQuery, 'cursor' | 'limit'>, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'follow_up.exported',
        entityType: 'follow_up',
        entityId: actor.tenantId,
        afterJson: { tab: query.tab, hasSearch: !!query.q, doctorFiltered: !!query.doctorId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
}
