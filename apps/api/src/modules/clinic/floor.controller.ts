import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createFloorRequestSchema, updateFloorRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { FloorService } from './floor.service';

/** "Tầng" (docs/DECISIONS.md #055) — dùng chung `clinic_config.*` với `RoomController`, cùng lý do PRD ADM-02. */
@Controller('floors')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FloorController {
  constructor(private readonly floorService: FloorService) {}

  @Post()
  @RequirePermission('clinic_config', 'update')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createFloorRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.floorService.createFloor(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Get()
  @RequirePermission('clinic_config', 'read')
  async list(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.floorService.listFloors(tenantId);
  }

  @Patch(':id')
  @RequirePermission('clinic_config', 'update', { entityIdParam: 'id' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateFloorRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.floorService.updateFloor(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
