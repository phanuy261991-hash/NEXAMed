import { Injectable, NotFoundException } from '@nestjs/common';
import type { ListRoomOptionsResponse, RoomSession } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { RoomRepository } from './room.repository';
import { DoctorRoomSessionRepository } from './doctor-room-session.repository';

/**
 * "Phòng làm việc hôm nay" (docs/DECISIONS.md #054) — TỰ-PHỤC VỤ: mọi phương thức chỉ thao tác
 * trên chính `doctorId` truyền vào (controller luôn truyền `req.user.userId`, không nhận từ
 * client) — không cần `data_scope`/`PermissionGuard`, cùng nguyên tắc `AuthService.getCurrentUser()`.
 */
@Injectable()
export class DoctorRoomSessionService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly roomRepository: RoomRepository,
    private readonly doctorRoomSessionRepository: DoctorRoomSessionRepository,
  ) {}

  /** Chiếu tối thiểu phòng đang active — web dùng để quyết định có bật UI phòng hay không (`items.length > 1`). */
  async listRoomOptions(tenantId: string): Promise<ListRoomOptionsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rooms = await this.roomRepository.list(tx, tenantId);
      return { items: rooms.filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name })) };
    });
  }

  async getMySession(tenantId: string, doctorId: string): Promise<RoomSession | null> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.doctorRoomSessionRepository.findToday(tx, tenantId, doctorId));
  }

  async setMySession(tenantId: string, doctorId: string, roomId: string, meta: RequestMeta): Promise<RoomSession> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const room = await this.roomRepository.findById(tx, tenantId, roomId);
      if (!room || !room.isActive) {
        throw new NotFoundException();
      }

      await this.doctorRoomSessionRepository.upsertToday(tx, tenantId, doctorId, roomId, doctorId);

      await writeAuditLog(tx, tenantId, {
        actorId: doctorId,
        action: 'doctor_room_session.set',
        entityType: 'doctor_room_session',
        entityId: doctorId,
        afterJson: { roomId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const session = await this.doctorRoomSessionRepository.findToday(tx, tenantId, doctorId);
      if (!session) {
        // Không thể xảy ra thật — vừa upsert xong trong cùng transaction.
        throw new NotFoundException();
      }
      return session;
    });
  }
}
