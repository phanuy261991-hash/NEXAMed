import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { cancelEncounterRequestSchema, startConsultationRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { EncounterService } from './encounter.service';

/** Transition endpoints của lượt khám (Sprint 3) — tạo encounter (check-in) thuộc `reception.controller.ts`, không phải đây. */
@Controller('encounters')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class EncounterController {
  constructor(private readonly encounterService: EncounterService) {}

  @Post(':id/start')
  @RequirePermission('encounter', 'update', { entityIdParam: 'id' })
  @HttpCode(200)
  async start(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = startConsultationRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.startConsultation(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/cancel')
  @RequirePermission('encounter', 'cancel', { entityIdParam: 'id' })
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = cancelEncounterRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.cancelEncounter(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }
}
