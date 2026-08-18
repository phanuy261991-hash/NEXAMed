import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createExamStationRequestSchema, listExamStationsQuerySchema, updateExamStationRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ExamStationService } from './exam-station.service';

/** "Bàn khám / Ghế" (docs/DECISIONS.md #055) — dùng chung `clinic_config.*`, cùng lý do `RoomController`/`FloorController`. */
@Controller('exam-stations')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ExamStationController {
  constructor(private readonly examStationService: ExamStationService) {}

  @Post()
  @RequirePermission('clinic_config', 'update')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createExamStationRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.examStationService.createExamStation(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Get()
  @RequirePermission('clinic_config', 'read')
  async list(@Query('roomId') roomId: string | undefined, @Req() req: Request) {
    const { roomId: parsedRoomId } = listExamStationsQuerySchema.parse({ roomId });
    const { tenantId } = req.user!;
    return this.examStationService.listExamStations(tenantId, parsedRoomId);
  }

  @Patch(':id')
  @RequirePermission('clinic_config', 'update', { entityIdParam: 'id' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateExamStationRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.examStationService.updateExamStation(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
