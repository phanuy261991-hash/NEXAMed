import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createRoomRequestSchema, updateRoomRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { RoomService } from './room.service';

/**
 * S2-07, ADM-02 — dùng chung permission `clinic_config.*` với `ClinicSettingsController`: PRD
 * ADM-02 gộp "giờ làm việc, độ dài slot, phòng, mẫu in" làm một yêu cầu, không có lý do tách
 * quyền riêng cho "phòng" ở v1 (xem packages/shared/src/clinic.ts).
 */
@Controller('rooms')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Post()
  @RequirePermission('clinic_config', 'update')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createRoomRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.roomService.createRoom(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Get()
  @RequirePermission('clinic_config', 'read')
  async list(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.roomService.listRooms(tenantId);
  }

  @Patch(':id')
  @RequirePermission('clinic_config', 'update', { entityIdParam: 'id' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateRoomRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.roomService.updateRoom(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
