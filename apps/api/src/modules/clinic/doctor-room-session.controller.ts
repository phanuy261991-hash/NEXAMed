import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { setRoomSessionRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { extractRequestMeta } from '../../common/request-meta';
import { DoctorRoomSessionService } from './doctor-room-session.service';

/**
 * "Phòng làm việc hôm nay" (docs/DECISIONS.md #054) — endpoint TỰ-PHỤC VỤ: chỉ `JwtAuthGuard`,
 * KHÔNG `PermissionGuard`/`@RequirePermission` (đã xác nhận `PermissionGuard` cho qua route thiếu
 * decorator, cùng nguyên tắc `GET /auth/me`). Mọi user đã đăng nhập chỉ đọc/ghi đúng phiên của
 * chính mình (`req.user.userId`), không nhận `doctorId` từ client — không có bề mặt cần kiểm quyền.
 */
@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class DoctorRoomSessionController {
  constructor(private readonly doctorRoomSessionService: DoctorRoomSessionService) {}

  @Get('options')
  async listOptions(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.doctorRoomSessionService.listRoomOptions(tenantId);
  }

  @Get('my-session')
  async getMySession(@Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.doctorRoomSessionService.getMySession(tenantId, userId);
  }

  @Put('my-session')
  async setMySession(@Body() body: unknown, @Req() req: Request) {
    const dto = setRoomSessionRequestSchema.parse(body);
    const { tenantId, userId } = req.user!;
    return this.doctorRoomSessionService.setMySession(tenantId, userId, dto.roomId, extractRequestMeta(req));
  }
}
