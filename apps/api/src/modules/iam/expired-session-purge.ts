import type { PrismaClient } from '@prisma/client';
import { EXPIRED_SESSION_RETENTION_DAYS } from '@nexamed/core';
import type { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import type { SessionRepository } from './session.repository';

/**
 * Xoá cứng phiên đăng nhập đã hết hạn quá `EXPIRED_SESSION_RETENTION_DAYS` ngày cho MỌI công ty (docs/DECISIONS.md #244) — cùng khuôn `purgeSystemLogsForAllTenants`
 * (#091): lặp từng công ty, mở transaction riêng qua `UnitOfWorkService` để RLS tự giới hạn đúng phạm vi. Hàm thuần (nhận dependency qua tham số) để job `@Cron` gọi được.
 *
 * Vì sao xoá cứng (ngoại lệ với quy tắc "không xoá cứng dữ liệu nghiệp vụ" ở CLAUDE.md): `user_session` là dữ liệu KỸ THUẬT của phiên đăng nhập, không phải hồ sơ bệnh án.
 * Mỗi lần gia hạn phiên (15 phút/lần) sinh một dòng mới, nên không dọn thì bảng phình vô hạn — đo thật 21/10/2026: 53% số dòng trên máy dev đã hết hạn mà vẫn nằm lại.
 * Dấu vết "ai đăng nhập lúc nào" vẫn còn ở `audit_log` (`auth.login_success`), nơi giữ vĩnh viễn.
 */
export async function purgeExpiredSessionsForAllTenants(prisma: PrismaClient, unitOfWork: UnitOfWorkService, sessionRepository: SessionRepository): Promise<number> {
  const tenants = await prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
  const cutoff = new Date(Date.now() - EXPIRED_SESSION_RETENTION_DAYS * 24 * 60 * 60_000);

  let totalDeleted = 0;
  for (const tenant of tenants) {
    totalDeleted += await unitOfWork.runInTenantScope(tenant.id, (tx) => sessionRepository.purgeExpiredBefore(tx, tenant.id, cutoff));
  }
  return totalDeleted;
}
