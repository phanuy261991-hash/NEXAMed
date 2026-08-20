import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  cancelEncounterRequestSchema,
  completeConsultationRequestSchema,
  saveClinicalNoteRequestSchema,
  saveDiagnosesRequestSchema,
  startConsultationRequestSchema,
} from '@nexamed/shared';
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

  /** Màn hình khám (S3-05) — gộp tiền sử + dị ứng + sinh hiệu trong một request. */
  @Get(':id/consultation')
  @RequirePermission('encounter', 'read', { entityIdParam: 'id' })
  async getConsultation(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.encounterService.getConsultationDetail(tenantId, userId, req.dataScope!, id);
  }

  @Put(':id/diagnoses')
  @RequirePermission('diagnosis', 'create', { entityIdParam: 'id' })
  async saveDiagnoses(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveDiagnosesRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.saveDiagnoses(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Put(':id/clinical-note')
  @RequirePermission('clinical_note', 'create', { entityIdParam: 'id' })
  async saveClinicalNote(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveClinicalNoteRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.saveClinicalNote(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** "Hoàn tất khám" — IN_CONSULTATION → COMPLETED, chỉ yêu cầu đúng một chẩn đoán chính. */
  @Post(':id/complete')
  @RequirePermission('encounter', 'update', { entityIdParam: 'id' })
  @HttpCode(200)
  async complete(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = completeConsultationRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.completeConsultation(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }
}
