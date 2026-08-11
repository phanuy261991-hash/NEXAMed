import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { createPatientRequestSchema, listPatientsQuerySchema, updatePatientRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { extractRequestMeta } from '../../common/request-meta';
import { PatientService } from './patient.service';

@Controller('patients')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Post()
  @RequirePermission('patient', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createPatientRequestSchema.parse(body);
    // req.user luôn có giá trị ở đây — JwtAuthGuard đã throw UnauthorizedException trước đó nếu thiếu.
    const { userId, tenantId } = req.user!;
    return this.patientService.createPatient(tenantId, userId, dto, extractRequestMeta(req));
  }

  /**
   * Không gắn `@AuditView` — decorator này ghi 1 dòng audit cho ĐÚNG 1 entityId (đọc từ route
   * param), không khớp hình dạng "xem một danh sách nhiều bệnh nhân". Audit cho thao tác xem
   * danh sách (nếu cần) là việc khác, chưa có yêu cầu cụ thể ở PRD/security-audit.md.
   */
  @Get()
  @RequirePermission('patient', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listPatientsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.patientService.listPatients(tenantId, dto);
  }

  @Get(':id')
  @RequirePermission('patient', 'read', { entityIdParam: 'id' })
  @AuditView('patient')
  @UseInterceptors(AuditViewInterceptor)
  async getById(@Param('id') id: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.patientService.getPatient(tenantId, id);
  }

  @Patch(':id')
  @RequirePermission('patient', 'update', { entityIdParam: 'id' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updatePatientRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.patientService.updatePatient(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
