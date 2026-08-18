import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Appointment } from '@prisma/client';
import {
  AppointmentInvalidReferenceError,
  AppointmentNotCancellableError,
  AppointmentSlotConflictError,
  CLINIC_CONFIG_READER_PORT,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  formatDisplayCode,
  vietnamDayRange,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import {
  APPOINTMENT_BOOKING_CODE_PREFIX,
  type AppointmentPhoneLookupResponse,
  type AppointmentSummary,
  type CancelAppointmentRequest,
  type ClinicSettings,
  type CreateAppointmentRequest,
  type DataScope,
  type EditAppointmentRequest,
  type ListAppointmentsQuery,
  type ListAppointmentsResponse,
  type ListDoctorsResponse,
  type RescheduleAppointmentRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { AppointmentRepository } from './appointment.repository';

const EXCLUSION_CONSTRAINT_NAME = 'appointment_doctor_slot_excl';

/**
 * Postgres exclusion-constraint violation (SQLSTATE 23P01, C2 trong docs/ERD.md) không nằm
 * trong bảng mã lỗi Prisma đã biết (P2002 unique, P2003 FK...) — Prisma Client trả về
 * `PrismaClientUnknownRequestError` (không phải `PrismaClientKnownRequestError` như trùng CCCD
 * ở patient module), message thô kèm nguyên văn lỗi Postgres. Xác nhận thật bằng cách chạy test
 * đặt lịch trùng khung giờ trong appointment-http.spec.ts trước khi viết điều kiện này — không
 * đoán mã lỗi từ tài liệu Prisma. Kiểm cả mã SQLSTATE lẫn tên constraint để không nhầm với lỗi
 * DB khác cũng rơi vào nhánh Unknown.
 */
function isExclusionViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientUnknownRequestError &&
    err.message.includes('23P01') &&
    err.message.includes(EXCLUSION_CONSTRAINT_NAME)
  );
}

function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

/**
 * Điều phối use case lịch hẹn (S2-05, APP-01/02/03) — sinh lỗi nghiệp vụ từ vi phạm constraint
 * DB, ghi audit trong cùng transaction. Xem .claude/docs/coding-standards.md mục "Tầng trong API".
 */
@Injectable()
export class AppointmentService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly appointmentRepository: AppointmentRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  /** `GET /appointments/doctors` (S2-09) — chiếu tối thiểu, gắn quyền `appointment.read` (xem docs/DECISIONS.md). */
  async listDoctors(tenantId: string): Promise<ListDoctorsResponse> {
    const items = await this.doctorDirectory.listActiveDoctors(tenantId);
    return { items };
  }

  /** `GET /appointments/schedule-config` (S2-09) — cùng dữ liệu `GET /clinic-settings` nhưng gắn quyền `appointment.read`. */
  async getScheduleConfig(tenantId: string): Promise<ClinicSettings> {
    return this.clinicConfigReader.getScheduleConfig(tenantId) as Promise<ClinicSettings>;
  }

  /**
   * Tra cứu theo SĐT lúc đặt lịch (docs/DECISIONS.md #032) — tự điền Họ tên nếu SĐT đã từng đặt,
   * kèm số lần huỷ để phía web tự quyết định hiện cảnh báo spam (ngưỡng
   * `APPOINTMENT_SPAM_CANCELLED_THRESHOLD`, không chặn đặt lịch — chỉ cảnh báo).
   */
  async lookupByPhone(tenantId: string, phone: string): Promise<AppointmentPhoneLookupResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.appointmentRepository.findByPhone(tx, tenantId, phone));
  }

  async createAppointment(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    dto: CreateAppointmentRequest,
    meta: RequestMeta,
  ): Promise<AppointmentSummary> {
    // scope `personal` (doctor.appointment.create = personal, .claude/docs/security-audit.md):
    // chỉ tạo được lịch cho chính mình, không đặt hộ bác sĩ khác. scope `global`
    // (receptionist/clinic_admin) không bị giới hạn field này.
    if (dataScope === 'personal' && dto.doctorId !== actorId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'Chỉ có thể tạo lịch hẹn cho chính mình.',
      });
    }

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      // Mã đặt lịch cấp atomic qua code_sequence — cùng khuôn `patient_code`
      // (PatientService.createPatient()), prefix riêng `LH` (APPOINTMENT_BOOKING_CODE_PREFIX).
      const seq = await this.codeSequenceRepository.next(tx, tenantId, APPOINTMENT_BOOKING_CODE_PREFIX, actorId);
      const bookingCode = formatDisplayCode(APPOINTMENT_BOOKING_CODE_PREFIX, new Date(), seq);

      let created: Appointment;
      try {
        created = await this.appointmentRepository.create(tx, tenantId, actorId, {
          bookingCode,
          fullName: dto.fullName,
          phone: dto.phone,
          reason: dto.reason ?? null,
          doctorId: dto.doctorId,
          roomId: dto.roomId ?? null,
          scheduledAt: new Date(dto.scheduledAt),
          durationMinutes: dto.durationMinutes,
          source: dto.source,
        });
      } catch (err) {
        if (isExclusionViolation(err)) {
          throw new AppointmentSlotConflictError();
        }
        if (isForeignKeyViolation(err)) {
          throw new AppointmentInvalidReferenceError();
        }
        throw err;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'appointment.created',
        entityType: 'appointment',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created);
    });
  }

  async getAppointment(tenantId: string, actorId: string, dataScope: DataScope, id: string): Promise<AppointmentSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const appointment = await this.appointmentRepository.findById(tx, tenantId, id);
      if (!appointment || (dataScope === 'personal' && appointment.doctorId !== actorId)) {
        // Lịch hẹn của bác sĩ khác, ngoài scope `personal` của actor, coi như không tồn tại —
        // cùng triết lý 404 thay vì 403 khi xuyên tenant (.claude/docs/multi-tenancy.md).
        // Break-glass cho tình huống này CHƯA nối vào PermissionGuard: guard hiện chỉ escalate
        // break-glass khi scope=none (xem permission.guard.ts), không phải khi scope=personal
        // nhưng bản ghi ngoài phạm vi cá nhân — khác giới hạn đã ghi ở permission.guard.ts cho
        // `patient` (personal/department coi như global vì patient không có "chủ sở hữu"):
        // `appointment` CÓ chủ sở hữu rõ ràng (`doctor_id`) nên áp dụng lọc thật ở đây, chỉ chưa
        // nối break-glass cho riêng trường hợp bị lọc bởi ownership (không phải bị chặn permission
        // hoàn toàn) — để dành khi có yêu cầu nghiệp vụ cụ thể cần vượt qua tình huống này.
        throw new NotFoundException();
      }
      return this.toSummary(appointment);
    });
  }

  async listAppointments(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    query: ListAppointmentsQuery,
  ): Promise<ListAppointmentsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      // scope `personal`: ép lọc theo chính actor, bỏ qua `doctorId` client gửi lên nếu có —
      // không cho dò lịch của bác sĩ khác qua query param.
      const doctorId = dataScope === 'personal' ? actorId : query.doctorId;
      // `date` (S2-09, chế độ lưới): quy đổi biên ngày theo giờ Việt Nam, không cắt mốc theo UTC
      // server (CLAUDE.md) — xem packages/core/src/date/vietnam-day-range.ts.
      const dayRange = query.date ? vietnamDayRange(query.date) : null;
      const rows = await this.appointmentRepository.list(tx, tenantId, {
        cursor: query.cursor,
        take: query.limit + 1,
        doctorId,
        scheduledAtFrom: dayRange?.startUtc,
        scheduledAtTo: dayRange?.endUtc,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? lastItem.id : null;
      return { items: items.map((a) => this.toSummary(a)), nextCursor };
    });
  }

  /**
   * S2-06, APP-04 — huỷ lịch bắt buộc lý do, ghi audit. Chỉ huỷ được lịch còn `SCHEDULED`
   * (.claude/docs/clinical-workflow.md mục "Đặt lịch") — đã `CANCELLED`/`NO_SHOW`/`CONVERTED`
   * thì không huỷ lại được qua đường này.
   */
  async cancelAppointment(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: CancelAppointmentRequest,
    meta: RequestMeta,
  ): Promise<AppointmentSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.appointmentRepository.findById(tx, tenantId, id);
      // Cùng triết lý 404 (không phải 403) với getAppointment() — xem comment ở đó.
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      if (existing.status !== 'SCHEDULED') {
        throw new AppointmentNotCancellableError();
      }

      const count = await this.appointmentRepository.cancel(tx, tenantId, id, dto.version, dto.cancelReason, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'appointment.cancelled',
        entityType: 'appointment',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.appointmentRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  /**
   * Sửa lịch hẹn TRONG NGÀY (khôi phục 2026-08-18, tồn tại song song với `rescheduleAppointment()`
   * bên dưới — chủ dự án yêu cầu 2 thao tác tách biệt: "Sửa lịch" đổi giờ/bác sĩ/phòng/thời lượng
   * TẠI CHỖ, cùng id, không đổi ngày; "Dời lịch" tạo lịch mới cho ngày khác). Cùng khuôn
   * `cancelAppointment()`: 404 khi ngoài tenant/scope, 409 khi không còn `SCHEDULED` hoặc version
   * lệch, bắt lỗi exclusion/FK giống `createAppointment()`.
   */
  async editAppointment(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: EditAppointmentRequest,
    meta: RequestMeta,
  ): Promise<AppointmentSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.appointmentRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      if (existing.status !== 'SCHEDULED') {
        throw new AppointmentNotCancellableError();
      }
      if (dataScope === 'personal' && dto.doctorId !== actorId) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Chỉ có thể sửa lịch hẹn cho chính mình.',
        });
      }

      let count: number;
      try {
        count = await this.appointmentRepository.updateDetails(
          tx,
          tenantId,
          id,
          dto.version,
          {
            doctorId: dto.doctorId,
            roomId: dto.roomId ?? null,
            scheduledAt: new Date(dto.scheduledAt),
            durationMinutes: dto.durationMinutes,
          },
          actorId,
        );
      } catch (err) {
        if (isExclusionViolation(err)) {
          throw new AppointmentSlotConflictError();
        }
        if (isForeignKeyViolation(err)) {
          throw new AppointmentInvalidReferenceError();
        }
        throw err;
      }
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'appointment.updated',
        entityType: 'appointment',
        entityId: id,
        beforeJson: { scheduledAt: existing.scheduledAt.toISOString(), doctorId: existing.doctorId },
        afterJson: { scheduledAt: dto.scheduledAt, doctorId: dto.doctorId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.appointmentRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  /**
   * Dời lịch hẹn (thay thế mô hình S2-09 "sửa tại chỗ" — yêu cầu chủ dự án 2026-08-18): lịch cũ
   * đánh dấu `RESCHEDULED` (giữ nguyên làm lịch sử, không sửa/xoá), tạo MỘT lịch hẹn mới cho
   * ngày/giờ đã chọn — kế thừa `fullName`/`phone`/`reason`/`roomId`/`durationMinutes`/`source` từ
   * lịch cũ (client chỉ gửi `doctorId`+`scheduledAt` mới). Cùng khuôn `cancelAppointment()`: 404
   * khi ngoài tenant/scope, 409 khi không còn `SCHEDULED` hoặc version lệch. Bắt lỗi exclusion/FK
   * giống hệt `createAppointment()` (lịch mới trùng giờ bác sĩ khác vẫn báo
   * `APPOINTMENT_SLOT_CONFLICT`, không có đường tắt bỏ qua constraint) — cả hai bước (đánh dấu +
   * tạo mới) chạy trong CÙNG transaction, lỗi ở bước tạo mới sẽ rollback luôn bước đánh dấu.
   */
  async rescheduleAppointment(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: RescheduleAppointmentRequest,
    meta: RequestMeta,
  ): Promise<AppointmentSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.appointmentRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      if (existing.status !== 'SCHEDULED') {
        throw new AppointmentNotCancellableError();
      }
      // scope `personal`: không được dời lịch của mình sang cho bác sĩ khác — cùng điều kiện
      // `createAppointment()` (không đặt/không chuyển hộ bác sĩ khác).
      if (dataScope === 'personal' && dto.doctorId !== actorId) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Chỉ có thể dời lịch hẹn cho chính mình.',
        });
      }

      const supersededCount = await this.appointmentRepository.markRescheduled(tx, tenantId, id, dto.version, actorId);
      if (supersededCount === 0) {
        throw new ConcurrentModificationError();
      }

      const seq = await this.codeSequenceRepository.next(tx, tenantId, APPOINTMENT_BOOKING_CODE_PREFIX, actorId);
      const bookingCode = formatDisplayCode(APPOINTMENT_BOOKING_CODE_PREFIX, new Date(), seq);

      let created: Appointment;
      try {
        created = await this.appointmentRepository.create(tx, tenantId, actorId, {
          bookingCode,
          fullName: existing.fullName,
          phone: existing.phone,
          reason: existing.reason,
          doctorId: dto.doctorId,
          roomId: existing.roomId,
          scheduledAt: new Date(dto.scheduledAt),
          durationMinutes: existing.durationMinutes,
          source: existing.source,
          rescheduledFromId: existing.id,
        });
      } catch (err) {
        if (isExclusionViolation(err)) {
          throw new AppointmentSlotConflictError();
        }
        if (isForeignKeyViolation(err)) {
          throw new AppointmentInvalidReferenceError();
        }
        throw err;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'appointment.rescheduled',
        entityType: 'appointment',
        entityId: existing.id,
        beforeJson: { status: 'SCHEDULED', scheduledAt: existing.scheduledAt.toISOString(), doctorId: existing.doctorId },
        afterJson: { status: 'RESCHEDULED', newAppointmentId: created.id, scheduledAt: dto.scheduledAt, doctorId: dto.doctorId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created);
    });
  }

  private toSummary(appointment: Appointment): AppointmentSummary {
    return {
      id: appointment.id,
      bookingCode: appointment.bookingCode,
      patientId: appointment.patientId,
      fullName: appointment.fullName,
      phone: appointment.phone,
      reason: appointment.reason,
      doctorId: appointment.doctorId,
      roomId: appointment.roomId,
      scheduledAt: appointment.scheduledAt.toISOString(),
      durationMinutes: appointment.durationMinutes,
      status: appointment.status,
      source: appointment.source,
      cancelReason: appointment.cancelReason,
      rescheduledFromId: appointment.rescheduledFromId,
      version: appointment.version,
    };
  }
}
