import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { checkInRequestSchema, receptionListQuerySchema, recordVitalSignRequestSchema, registerReceptionRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ReceptionService } from './reception.service';

@Controller('reception')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ReceptionController {
  constructor(private readonly receptionService: ReceptionService) {}

  @Post('check-in')
  @RequirePermission('encounter', 'create')
  @HttpCode(200)
  async checkIn(@Body() body: unknown, @Req() req: Request) {
    const dto = checkInRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.receptionService.checkIn(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  /** "Tiếp nhận bệnh nhân" — tạo `encounter` trực tiếp, khách không qua đặt lịch trước. */
  @Post('direct')
  @RequirePermission('encounter', 'create')
  @HttpCode(200)
  async registerDirect(@Body() body: unknown, @Req() req: Request) {
    const dto = registerReceptionRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.receptionService.registerDirect(tenantId, userId, dto, extractRequestMeta(req));
  }

  /** "Danh sách tiếp nhận" (mặc định) / "Hàng đợi khám" (khi truyền `doctorId`) — cùng nguồn dữ liệu. */
  @Get('list')
  @RequirePermission('encounter', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = receptionListQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.receptionService.listReceptions(tenantId, userId, req.dataScope!, dto.date, dto.doctorId, dto.includeDepartmentPool);
  }

  @Post('encounters/:encounterId/vital-signs')
  @RequirePermission('vital_sign', 'create', { entityIdParam: 'encounterId' })
  @HttpCode(200)
  async recordVitalSigns(@Param('encounterId') encounterId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = recordVitalSignRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.receptionService.recordVitalSigns(tenantId, userId, req.dataScope!, encounterId, dto, extractRequestMeta(req));
  }
}
