import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { putServiceNormRequestSchema, recordConsumptionRequestSchema, reverseConsumptionRequestSchema, serviceNormQuerySchema } from '@nexamed/shared';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { requireBranchId } from '../../common/branch-context';
import { ServiceConsumptionService } from './service-consumption.service';

/**
 * "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4). Định mức: chung cả công ty (`service_consumption.read`/`norm`). Ghi/đảo phiếu: theo chi nhánh đang làm việc
 * (`service_consumption.record`/`reverse`). Giá vốn chỉ trả cho người có `service_consumption.report` (kiểm trong service, không cần route riêng).
 */
@Controller('service-consumption')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ServiceConsumptionController {
  constructor(private readonly service: ServiceConsumptionService) {}

  @Get('norms')
  @RequirePermission('service_consumption', 'read')
  async getNorm(@Query() query: unknown, @Req() req: Request) {
    return this.service.getNorm(req.user!.tenantId, serviceNormQuerySchema.parse(query));
  }

  @Put('norms')
  @RequirePermission('service_consumption', 'norm')
  async putNorm(@Query() query: unknown, @Body() body: unknown, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.putNorm(tenantId, userId, serviceNormQuerySchema.parse(query), putServiceNormRequestSchema.parse(body), extractRequestMeta(req));
  }

  /** Dịch vụ của lượt khám kèm định mức và phiếu đã ghi — phục vụ màn nhập kết quả, tab "Vật tư đã dùng" và hộp thoại huỷ dịch vụ. Có tên dịch vụ của bệnh nhân nên ghi nhật ký "xem". */
  @Get('encounters/:encounterId')
  @RequirePermission('service_consumption', 'read', { entityIdParam: 'encounterId' })
  @AuditView('encounter', { paramName: 'encounterId' })
  @UseInterceptors(AuditViewInterceptor)
  async getForEncounter(@Param('encounterId', ParseUUIDPipe) encounterId: string, @Req() req: Request) {
    return this.service.getForEncounter(req.user!.tenantId, requireBranchId(req.user!), req.user!.userId, encounterId);
  }

  @Post('records')
  @HttpCode(200)
  @RequirePermission('service_consumption', 'record')
  async record(@Body() body: unknown, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.record(tenantId, requireBranchId(req.user!), userId, recordConsumptionRequestSchema.parse(body), extractRequestMeta(req));
  }

  @Post('records/:issueId/reverse')
  @HttpCode(200)
  @RequirePermission('service_consumption', 'reverse')
  async reverse(@Param('issueId', ParseUUIDPipe) issueId: string, @Body() body: unknown, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.reverse(tenantId, requireBranchId(req.user!), userId, issueId, reverseConsumptionRequestSchema.parse(body), extractRequestMeta(req));
  }
}
