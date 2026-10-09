import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type WorkScheduleSubmission } from '@prisma/client';
import {
  CLINIC_CONFIG_READER_PORT,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  ScheduleSubmissionEmptyError,
  ScheduleSubmissionInvalidStatusError,
  WorkShiftAssignmentMonthNotOpenError,
  WorkShiftAssignmentSelfScheduleDisabledError,
  getVietnamDateString,
  isMonthOpenForSelfRegistration,
  shiftDurationMinutes,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  ApproveScheduleSubmissionRequest,
  DataScope,
  ListScheduleSubmissionsQuery,
  ListScheduleSubmissionsResponse,
  ReturnScheduleSubmissionRequest,
  ScheduleSubmissionItem,
  ScheduleSubmissionPendingCountResponse,
  SubmitScheduleSubmissionRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { WorkScheduleSubmissionRepository } from './work-schedule-submission.repository';
import { WorkShiftAssignmentRepository } from './work-shift-assignment.repository';

function monthRange(month: string): { from: string; to: string } {
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year ?? 1970, m ?? 1, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * "Duyệt đăng ký ca theo tháng" (#225) — nhân viên gửi duyệt CẢ THÁNG (chỉ tháng sau tháng hiện tại, chỉ khi
 * công tắc "Cho phép nhân viên tự đăng ký ca" BẬT); người có `work_shift_assignment.approve` duyệt hoặc trả
 * lại (về Nháp kèm lý do). Quy tắc thêm/xoá ca theo trạng thái nằm ở `WorkShiftAssignmentService`.
 */
@Injectable()
export class WorkScheduleSubmissionService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: WorkScheduleSubmissionRepository,
    private readonly assignmentRepository: WorkShiftAssignmentRepository,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  async list(tenantId: string, actorId: string, dataScope: DataScope, query: ListScheduleSubmissionsQuery): Promise<ListScheduleSubmissionsResponse> {
    const userId = dataScope === 'personal' ? actorId : query.userId;
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.list(tx, tenantId, { month: query.month, status: query.status, userId }));
    return { items: await this.toItems(tenantId, rows) };
  }

  async pendingCount(tenantId: string): Promise<ScheduleSubmissionPendingCountResponse> {
    const count = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.countSubmitted(tx, tenantId));
    return { count };
  }

  /** Nhân viên gửi duyệt cả tháng của CHÍNH MÌNH. */
  async submit(tenantId: string, actorId: string, dto: SubmitScheduleSubmissionRequest, meta: RequestMeta): Promise<ScheduleSubmissionItem> {
    if (!(await this.clinicConfigReader.getAllowStaffSelfScheduleEnabled(tenantId))) {
      throw new WorkShiftAssignmentSelfScheduleDisabledError();
    }
    if (!isMonthOpenForSelfRegistration(dto.month, getVietnamDateString())) {
      throw new WorkShiftAssignmentMonthNotOpenError();
    }

    const saved = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findByUserMonth(tx, tenantId, actorId, dto.month);
      if (existing && existing.status !== 'DRAFT') {
        throw new ScheduleSubmissionInvalidStatusError();
      }
      const { from, to } = monthRange(dto.month);
      const assignments = await this.assignmentRepository.listForUserInRange(tx, tenantId, actorId, from, to);
      if (assignments.length === 0) {
        throw new ScheduleSubmissionEmptyError();
      }

      let row: WorkScheduleSubmission | null;
      try {
        row = await this.repository.upsertSubmitted(tx, tenantId, actorId, actorId, dto.month, existing);
      } catch (err) {
        // 2 yêu cầu gửi đồng thời cùng tạo dòng đầu tiên → unique `(tenant,user,month)`.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ScheduleSubmissionInvalidStatusError();
        throw err;
      }
      if (!row) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'work_schedule_submission.submitted',
        entityType: 'work_schedule_submission',
        entityId: row.id,
        afterJson: { userId: actorId, month: dto.month, shiftCount: assignments.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return row;
    });
    const [item] = await this.toItems(tenantId, [saved]);
    return item as ScheduleSubmissionItem;
  }

  async approve(tenantId: string, actorId: string, id: string, dto: ApproveScheduleSubmissionRequest, meta: RequestMeta): Promise<ScheduleSubmissionItem> {
    const saved = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const row = await this.repository.findById(tx, tenantId, id);
      if (!row) throw new NotFoundException();
      if (row.status !== 'SUBMITTED') throw new ScheduleSubmissionInvalidStatusError();
      const count = await this.repository.transition(tx, tenantId, id, dto.version, 'SUBMITTED', { status: 'APPROVED', decidedBy: actorId, decidedAt: new Date() }, actorId);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'work_schedule_submission.approved',
        entityType: 'work_schedule_submission',
        entityId: id,
        beforeJson: { status: 'SUBMITTED' },
        afterJson: { status: 'APPROVED', userId: row.userId, month: row.month },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.repository.findById(tx, tenantId, id);
    });
    const [item] = await this.toItems(tenantId, [saved as WorkScheduleSubmission]);
    return item as ScheduleSubmissionItem;
  }

  /** Trả lại bảng đang chờ duyệt: về Nháp, nhân viên thấy lý do và sửa lại được. */
  async returnBack(tenantId: string, actorId: string, id: string, dto: ReturnScheduleSubmissionRequest, meta: RequestMeta): Promise<ScheduleSubmissionItem> {
    const saved = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const row = await this.repository.findById(tx, tenantId, id);
      if (!row) throw new NotFoundException();
      if (row.status !== 'SUBMITTED') throw new ScheduleSubmissionInvalidStatusError();
      const count = await this.repository.transition(
        tx, tenantId, id, dto.version, 'SUBMITTED',
        { status: 'DRAFT', returnReason: dto.reason, returnedAt: new Date(), submittedAt: null, decidedBy: actorId, decidedAt: new Date() },
        actorId,
      );
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'work_schedule_submission.returned',
        entityType: 'work_schedule_submission',
        entityId: id,
        beforeJson: { status: 'SUBMITTED' },
        afterJson: { status: 'DRAFT', userId: row.userId, month: row.month, returnReason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.repository.findById(tx, tenantId, id);
    });
    const [item] = await this.toItems(tenantId, [saved as WorkScheduleSubmission]);
    return item as ScheduleSubmissionItem;
  }

  /** Gắn tên, khoa, số ca/giờ — đọc ngoài transaction ghi. */
  private async toItems(tenantId: string, rows: WorkScheduleSubmission[]): Promise<ScheduleSubmissionItem[]> {
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.flatMap((r) => [r.userId, ...(r.decidedBy ? [r.decidedBy] : [])]))];
    const months = rows.map((r) => r.month).sort();
    const [names, doctors, departmentNames, assignments] = await Promise.all([
      this.doctorDirectory.getUserFullNames(tenantId, userIds),
      this.doctorDirectory.listActiveDoctors(tenantId),
      this.doctorDirectory.getDepartmentNames(tenantId),
      this.unitOfWork.runInTenantScope(tenantId, (tx) =>
        this.assignmentRepository.listForUsersBetween(tx, tenantId, [...new Set(rows.map((r) => r.userId))], monthRange(months[0] as string).from, monthRange(months[months.length - 1] as string).to),
      ),
    ]);
    const doctorById = new Map(doctors.map((d) => [d.id, d]));
    const totals = new Map<string, { count: number; minutes: number }>();
    for (const a of assignments) {
      const key = `${a.userId}|${a.workDate.toISOString().slice(0, 7)}`;
      const t = totals.get(key) ?? { count: 0, minutes: 0 };
      t.count += 1;
      t.minutes += shiftDurationMinutes(a.workShift.startTime, a.workShift.endTime);
      totals.set(key, t);
    }
    return rows.map((r) => {
      const total = totals.get(`${r.userId}|${r.month}`) ?? { count: 0, minutes: 0 };
      const doctor = doctorById.get(r.userId);
      return {
        id: r.id,
        userId: r.userId,
        userFullName: names.get(r.userId) ?? '—',
        departmentName: doctor?.departmentId ? (departmentNames.get(doctor.departmentId) ?? null) : null,
        month: r.month,
        status: r.status as ScheduleSubmissionItem['status'],
        shiftCount: total.count,
        totalMinutes: total.minutes,
        submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
        decidedByName: r.decidedBy ? (names.get(r.decidedBy) ?? null) : null,
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        returnReason: r.returnReason,
        version: r.version,
      };
    });
  }
}
