import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Appointment } from '@prisma/client';

export interface EditAppointmentData {
  doctorId: string;
  roomId: string | null;
  scheduledAt: Date;
  durationMinutes: number;
}

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
  /** Chỉ có giá trị khi lịch này sinh ra từ một lần dời lịch — xem `reschedule()` bên dưới. */
  rescheduledFromId?: string;
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
        rescheduledFromId: data.rescheduledFromId,
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
   * ở S2-09). `status`: lọc theo trạng thái — thêm ở Sprint 3 cho `ReceptionService.listQueue()`
   * (chỉ cần `SCHEDULED`, không lộ lịch đã CANCELLED/NO_SHOW/CONVERTED vào hàng đợi); tuỳ chọn,
   * không ảnh hưởng caller cũ (`AppointmentService.listAppointments()` không truyền).
   */
  list(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { cursor?: string; take: number; doctorId?: string; scheduledAtFrom?: Date; scheduledAtTo?: Date; status?: Appointment['status'] },
  ): Promise<Appointment[]> {
    const where: Prisma.AppointmentWhereInput = { tenantId, deletedAt: null };
    if (params.doctorId) {
      where.doctorId = params.doctorId;
    }
    if (params.status) {
      where.status = params.status;
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
   * Đánh dấu "Không đến" THỦ CÔNG (S5-07, APP-05) — 1 lịch, kiểm `version` cho optimistic locking,
   * cùng khuôn `cancel()`. Dùng khi tenant tắt tự động đánh dấu.
   */
  async markNoShowManual(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.appointment.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'SCHEDULED' },
      data: { status: 'NO_SHOW', updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /**
   * Job nền tự động đánh dấu "Không đến" (S5-07) — `findScheduledPastThreshold()` chọn đúng các
   * lịch còn `SCHEDULED` đã quá `scheduledAt + ngưỡng` (không cộng `durationMinutes`, đúng
   * `.claude/docs/clinical-workflow.md`), `markNoShow()` cập nhật hàng loạt theo đúng danh sách id
   * đã chọn (không lặp lại điều kiện thời gian — tránh race giữa lúc SELECT và UPDATE kéo thêm
   * dòng mới đủ điều kiện). Không kiểm `version` — job hệ thống, không có client nào giữ version cũ.
   */
  findScheduledPastThreshold(tx: Prisma.TransactionClient, tenantId: string, cutoff: Date): Promise<Appointment[]> {
    return tx.appointment.findMany({ where: { tenantId, status: 'SCHEDULED', deletedAt: null, scheduledAt: { lt: cutoff } } });
  }

  async markNoShow(tx: Prisma.TransactionClient, tenantId: string, ids: string[], actorId: string): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await tx.appointment.updateMany({
      where: { tenantId, id: { in: ids }, status: 'SCHEDULED', deletedAt: null },
      data: { status: 'NO_SHOW', updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /**
   * Sửa lịch hẹn TRONG NGÀY (khôi phục 2026-08-18, tồn tại song song với `markRescheduled()`) —
   * cùng khuôn `cancel()`: `updateMany` ghép `version`/`status='SCHEDULED'` vào `WHERE` cho atomic.
   * Đổi `scheduledAt`/`durationMinutes`/`doctorId`/`roomId` TẠI CHỖ (không tạo bản ghi mới, không
   * đổi `status`) khi vẫn `SCHEDULED` nên exclusion constraint C2 tự áp lại đúng như lúc tạo mới.
   */
  async updateDetails(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    data: EditAppointmentData,
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
   * Dời lịch (thay thế mô hình S2-09 "sửa tại chỗ" — yêu cầu chủ dự án 2026-08-18): bước ĐẦU của
   * luồng dời lịch, chỉ đánh dấu lịch cũ `RESCHEDULED` (không sửa giờ/bác sĩ tại chỗ nữa). Cùng
   * khuôn `cancel()`: `updateMany` ghép `version`/`status='SCHEDULED'` vào `WHERE` cho atomic —
   * chặn race hai request cùng dời một lịch. `AppointmentService.rescheduleAppointment()` gọi tiếp
   * `create()` (ở trên) ngay sau đó, trong CÙNG transaction, để tạo lịch mới với
   * `rescheduledFromId` trỏ về `id` này.
   */
  async markRescheduled(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<number> {
    const result = await tx.appointment.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'SCHEDULED' },
      data: { status: 'RESCHEDULED', updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /**
   * Check-in (Sprint 3, Tiếp nhận) — chuyển `SCHEDULED → CONVERTED` VÀ gắn `patientId` (hồ sơ đã
   * resolve xong ở web trước khi gọi — tìm/tạo `patient`, xem `ReceptionService.checkIn()`), cùng
   * khuôn `cancel()`/`markRescheduled()`. Gọi từ `ReceptionModule` (không phải `AppointmentModule`) qua
   * `AppointmentRepository` export — xem docs/DECISIONS.md (quyết định kiến trúc chia sẻ
   * Repository giữa 2 module trong cùng 1 transaction check-in).
   */
  async checkin(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    patientId: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<number> {
    const result = await tx.appointment.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'SCHEDULED' },
      data: { status: 'CONVERTED', patientId, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
