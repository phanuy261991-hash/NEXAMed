import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { mergePatientsRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { PatientMergeService } from './patient-merge.service';

/** S5-06, PAT-04 — `patient.merge` chỉ cấp cho `clinic_admin` (global, đã seed sẵn từ trước). */
@Controller('patients')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientMergeController {
  constructor(private readonly patientMergeService: PatientMergeService) {}

  @Post('merge')
  @RequirePermission('patient', 'merge')
  @HttpCode(200)
  async merge(@Body() body: unknown, @Req() req: Request) {
    const dto = mergePatientsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.patientMergeService.mergePatients(tenantId, userId, dto, extractRequestMeta(req));
  }
}
