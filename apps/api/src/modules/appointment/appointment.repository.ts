import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Appointment } from '@prisma/client';

export interface CreateAppointmentData {
  bookingCode: string;
  fullName: string;
  phone: string;
  reason: string | null;
  doctorId: string;
  roomId: string | null;
  scheduledAt: Date;
  durationMinutes: number;
  source: Prisma.AppointmentCreateInput['source'];
}

export interface RescheduleAppointmentData {
  doctorId: string;
  roomId: string | null;
  scheduledAt: Date;
  durationMinutes: number;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `appointment` — theo .claude/docs/coding-standards.md. */
@Injectable()
export class AppointmentRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateAppointmentData): Promise<Appointment> {
    return tx.appointment.create({
      data: {
        tenantId,
        // patientId luôn null lúc tạo — đặt lịch "lead capture" không tạo/gắn patient
        // (docs/DECISIONS.md #032). Cột để sẵn cho Tiếp nhận (Sprint 3) gắn hồ sơ thật sau.
        patientId: null,
        bookingCode: data.bookingCode,
        fullName: data.fullName,
        phone: data.phone,
        reason: data.reason,
        doctorId: data.doctorId,
        roomId: data.roomId,
        scheduledAt: data.scheduledAt,
        durationMinutes: data.durationMinutes,
        source: data.source,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Appointment | null> {
    return tx.appointment.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /**
   * `doctorId`: lọc theo bác sĩ — bắt buộc truyền khi actor chỉ có scope `personal`
   * (`doctor.appointment.read = personal`, xem .claude/docs/security-audit.md) để không lộ
   * lịch hẹn của bác sĩ khác. `scheduledAtFrom`/`scheduledAtTo`: lọc theo một ngày (S2-09, chế độ
   * lưới) — biên đã quy đổi giờ Việt Nam bằng `vietnamDayRange()` ở service, repository chỉ nhận
   * mốc UTC sẵn. Sắp theo `scheduledAt` (lịch theo thời gian, khác `patient.list()` sắp theo `id`
   * vì mục đích khác nhau — đây phục vụ xem lịch, không phải phân trang hồ sơ); kèm `id` làm khoá
   * phụ để có thứ tự ổn định khi trùng `scheduledAt`. Không còn join `patient` (docs/DECISIONS.md
   * #032 — `fullName`/`phone` giờ là cột riêng của `appointment`, đơn giản hoá lại phần join thêm
   * ở S2-09).
   */
  list(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { cursor?: string; take: number; doctorId?: string; scheduledAtFrom?: Date; scheduledAtTo?: Date },
  ): Promise<Appointment[]> {
    const where: Prisma.AppointmentWhereInput = { tenantId, deletedAt: null };
    if (params.doctorId) {
      where.doctorId = params.doctorId;
    }
    if (params.scheduledAtFrom || params.scheduledAtTo) {
      where.scheduledAt = {
        ...(params.scheduledAtFrom ? { gte: params.scheduledAtFrom } : {}),
        ...(params.scheduledAtTo ? { lt: params.scheduledAtTo } : {}),
      };
    }
    return tx.appointment.findMany({
      where,
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: params.take,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
  }

  /**
   * Tra cứu theo SĐT lúc đặt lịch (docs/DECISIONS.md #032) — tự điền tên (lấy lịch gần nhất theo
   * `scheduledAt`) + đếm số lần huỷ (cảnh báo spam, ngưỡng `APPOINTMENT_SPAM_CANCELLED_THRESHOLD`
   * ở service). Không lọc `deletedAt` — soft-delete không dùng cho `appointment` (chỉ đổi status),
   * nên điều kiện này chỉ để nhất quán với các query khác, không loại bỏ lịch hẹn cũ nào.
   */
  async findByPhone(tx: Prisma.TransactionClient, tenantId: string, phone: string): Promise<{ suggestedFullName: string | null; cancelledCount: number }> {
    const [latest, cancelledCount] = await Promise.all([
      tx.appointment.findFirst({
        where: { tenantId, phone, deletedAt: null },
        orderBy: { scheduledAt: 'desc' },
        select: { fullName: true },
      }),
      tx.appointment.count({ where: { tenantId, phone, status: 'CANCELLED', deletedAt: null } }),
    ]);
    return { suggestedFullName: latest?.fullName ?? null, cancelledCount };
  }

  /**
   * `updateMany` + kiểm `count` (không phải `update`) — cùng lý do `PatientRepository.updateIfVersionMatches`:
   * cần ghép `version = ?` vào `WHERE`, `update()` của Prisma chỉ nhận unique field làm điều kiện.
   * Thêm `status: 'SCHEDULED'` vào `WHERE` để atomic — service đã kiểm `status` trước đó bằng
   * `findById`, nhưng ghép lại ở đây chặn race hiếm khi hai request huỷ cùng lịch gần như đồng
   * thời (đơn giản hoá: coi race đó là `CONCURRENT_MODIFICATION`, không cần phân biệt nguyên nhân).
   */
  async cancel(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    cancelReason: string,
    actorId: string,
  ): Promise<number> {
    const result = await tx.appointment.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'SCHEDULED' },
      data: { status: 'CANCELLED', cancelReason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /**
   * Đổi/dời lịch (S2-09) — cùng khuôn `cancel()`: `updateMany` ghép `version`/`status='SCHEDULED'`
   * vào `WHERE` cho atomic. Đổi `scheduledAt`/`durationMinutes`/`doctorId`/`roomId` khi status vẫn
   * `SCHEDULED` nên exclusion constraint C2 (docs/ERD.md mục 4) tự áp lại đúng như lúc tạo mới —
   * không cần logic chống trùng riêng ở tầng ứng dụng.
   */
  async reschedule(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    data: RescheduleAppointmentData,
    actorId: string,
  ): Promise<number> {
    const result = await tx.appointment.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'SCHEDULED' },
      data: {
        doctorId: data.doctorId,
        roomId: data.roomId,
        scheduledAt: data.scheduledAt,
        durationMinutes: data.durationMinutes,
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
    return result.count;
  }

  /**
   * Check-in (docs/DECISIONS.md #032) — chuyển thẳng `SCHEDULED → CONVERTED`, cùng khuôn
   * `cancel()`/`reschedule()`. Chưa gắn `patientId`/tạo `encounter` (Tiếp nhận thật là việc
   * Sprint 3) — chỉ đổi trạng thái, xem `AppointmentService.checkinAppointment()`.
   */
  async checkin(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.appointment.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'SCHEDULED' },
      data: { status: 'CONVERTED', updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
