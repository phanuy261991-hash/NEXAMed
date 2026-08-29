import type { PrismaClient } from '@prisma/client';
import { SYSTEM_ACTOR_ID, type ClinicConfigReaderPort } from '@nexamed/core';
import type { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { AppointmentRepository } from './appointment.repository';

/**
 * Tự động đánh dấu "Không đến" cho MỌI tenant đã BẬT `noShowAutoEnabled` (S5-07, APP-05) — cùng
 * cấu trúc `purgeSystemLogsForAllTenants()` (`apps/api/src/modules/audit/system-log-purge.ts`):
 * lặp qua từng tenant, mở transaction riêng qua `UnitOfWorkService` để RLS tự giới hạn đúng phạm
 * vi. Hàm thuần (nhận dependency qua tham số) để `NoShowJob` (wrapper `@Cron`) gọi được.
 *
 * Ngưỡng đọc TRƯỚC transaction chính (qua port, tự mở transaction riêng) — cùng lý do
 * `ReceptionService.resolveRouting()`: không cần atomic tuyệt đối giữa đọc ngưỡng và cập nhật lịch
 * hẹn (lệch 1 lần chạy job nếu ngưỡng vừa đổi giữa chừng là chấp nhận được, không phải giao dịch
 * tài chính/lâm sàng).
 */
export async function markNoShowForAllTenants(
  prisma: PrismaClient,
  unitOfWork: UnitOfWorkService,
  appointmentRepository: AppointmentRepository,
  clinicConfigReader: ClinicConfigReaderPort,
): Promise<number> {
  const tenants = await prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });

  let totalMarked = 0;
  for (const tenant of tenants) {
    const { enabled, thresholdMinutes } = await clinicConfigReader.getNoShowConfig(tenant.id);
    if (!enabled) continue;

    const cutoff = new Date(Date.now() - thresholdMinutes * 60_000);
    const marked = await unitOfWork.runInTenantScope(tenant.id, async (tx) => {
      const due = await appointmentRepository.findScheduledPastThreshold(tx, tenant.id, cutoff);
      if (due.length === 0) return 0;

      const count = await appointmentRepository.markNoShow(
        tx,
        tenant.id,
        due.map((a) => a.id),
        SYSTEM_ACTOR_ID,
      );
      // Mỗi lần chuyển trạng thái ghi 1 dòng audit_log (.claude/docs/clinical-workflow.md) — đúng
      // cách appointment.cancelled/appointment.rescheduled đã làm, dù đây là job hệ thống.
      for (const appointment of due) {
        await writeAuditLog(tx, tenant.id, {
          actorId: SYSTEM_ACTOR_ID,
          action: 'appointment.no_show',
          entityType: 'appointment',
          entityId: appointment.id,
        });
      }
      return count;
    });
    totalMarked += marked;
  }
  return totalMarked;
}
