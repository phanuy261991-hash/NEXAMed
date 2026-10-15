import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { PARACLINICAL_GROUP_KINDS, PARACLINICAL_GROUP_PERMISSION_MODULE } from '@nexamed/core';
import { listPatientParaclinicalResultsQuerySchema, patientIndicatorTrendQuerySchema } from '@nexamed/shared';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { PatientParaclinicalResultsService } from './patient-paraclinical-results.service';
import type { ResultAccessScope } from './paraclinical-result.service';

const scopeFor = (group: 'lab' | 'imaging', req: Request): ResultAccessScope => ({
  dataScope: req.dataScope!,
  kinds: PARACLINICAL_GROUP_KINDS[group],
  permissionModule: PARACLINICAL_GROUP_PERMISSION_MODULE[group],
  branchId: requireBranchId(req.user!),
});

/**
 * Tab "Kết quả cận lâm sàng" ở Hồ sơ bệnh nhân — nhóm XÉT NGHIỆM (docs/DECISIONS.md #234). Gate `lab_result.read`. Kết quả đi theo người bệnh nên đọc mọi chi nhánh (như tab Lịch sử khám);
 * `@AuditView('patient')` ghi nhật ký "xem hồ sơ bệnh nhân" cho các danh sách, `@AuditView('paraclinical_result')` cho từng kết quả mở ra.
 */
@Controller('paraclinical/lab/patients/:patientId')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientLabResultsController {
  constructor(private readonly service: PatientParaclinicalResultsService) {}

  @Get('results')
  @RequirePermission('lab_result', 'read')
  @AuditView('patient', { paramName: 'patientId' })
  @UseInterceptors(AuditViewInterceptor)
  async list(@Param('patientId', ParseUUIDPipe) patientId: string, @Query() query: unknown, @Req() req: Request) {
    return this.service.list(req.user!.tenantId, req.user!.userId, scopeFor('lab', req), patientId, listPatientParaclinicalResultsQuerySchema.parse(query));
  }

  @Get('indicators')
  @RequirePermission('lab_result', 'read')
  @AuditView('patient', { paramName: 'patientId' })
  @UseInterceptors(AuditViewInterceptor)
  async indicators(@Param('patientId', ParseUUIDPipe) patientId: string, @Req() req: Request) {
    return this.service.listIndicators(req.user!.tenantId, req.user!.userId, scopeFor('lab', req), patientId);
  }

  @Get('indicators/trend')
  @RequirePermission('lab_result', 'read')
  @AuditView('patient', { paramName: 'patientId' })
  @UseInterceptors(AuditViewInterceptor)
  async trend(@Param('patientId', ParseUUIDPipe) patientId: string, @Query() query: unknown, @Req() req: Request) {
    return this.service.indicatorTrend(req.user!.tenantId, req.user!.userId, scopeFor('lab', req), patientId, patientIndicatorTrendQuerySchema.parse(query));
  }

  @Get('items/:itemId/result')
  @RequirePermission('lab_result', 'read')
  @AuditView('paraclinical_result', { paramName: 'itemId' })
  @UseInterceptors(AuditViewInterceptor)
  async getResult(@Param('patientId', ParseUUIDPipe) patientId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    return { form: await this.service.getForm(req.user!.tenantId, req.user!.userId, scopeFor('lab', req), patientId, itemId) };
  }

  @Post('items/:itemId/result/print')
  @RequirePermission('lab_result', 'read')
  @HttpCode(200)
  async printResult(@Param('patientId', ParseUUIDPipe) patientId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    await this.service.recordPrint(req.user!.tenantId, req.user!.userId, scopeFor('lab', req), patientId, itemId, extractRequestMeta(req));
    return { ok: true };
  }
}

/** Cùng tab — nhóm CĐHA & THĂM DÒ CHỨC NĂNG. Gate `imaging_result.read`. Không có diễn biến chỉ số (kết quả dạng mô tả/kết luận). */
@Controller('paraclinical/imaging/patients/:patientId')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientImagingResultsController {
  constructor(private readonly service: PatientParaclinicalResultsService) {}

  @Get('results')
  @RequirePermission('imaging_result', 'read')
  @AuditView('patient', { paramName: 'patientId' })
  @UseInterceptors(AuditViewInterceptor)
  async list(@Param('patientId', ParseUUIDPipe) patientId: string, @Query() query: unknown, @Req() req: Request) {
    return this.service.list(req.user!.tenantId, req.user!.userId, scopeFor('imaging', req), patientId, listPatientParaclinicalResultsQuerySchema.parse(query));
  }

  @Get('items/:itemId/result')
  @RequirePermission('imaging_result', 'read')
  @AuditView('paraclinical_result', { paramName: 'itemId' })
  @UseInterceptors(AuditViewInterceptor)
  async getResult(@Param('patientId', ParseUUIDPipe) patientId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    return { form: await this.service.getForm(req.user!.tenantId, req.user!.userId, scopeFor('imaging', req), patientId, itemId) };
  }

  @Post('items/:itemId/result/print')
  @RequirePermission('imaging_result', 'read')
  @HttpCode(200)
  async printResult(@Param('patientId', ParseUUIDPipe) patientId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    await this.service.recordPrint(req.user!.tenantId, req.user!.userId, scopeFor('imaging', req), patientId, itemId, extractRequestMeta(req));
    return { ok: true };
  }
}
