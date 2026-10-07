import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { saveClinicalOrderRequestSchema } from '@nexamed/shared';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ClinicalOrderService } from './clinical-order.service';

/**
 * Chỉ định cận lâm sàng của một lượt khám (Cận lâm sàng GĐ3, docs/DECISIONS.md #212). Bác sĩ chỉ chỉ định cho lượt khám của MÌNH
 * (`clinical_order.create` = `personal`); `read` mở cho lễ tân/điều dưỡng/clinic_admin. `PUT` thay TOÀN BỘ danh sách mong muốn.
 */
@Controller('encounters/:encounterId/clinical-orders')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ClinicalOrderController {
  constructor(private readonly service: ClinicalOrderService) {}

  // Chỉ định cận lâm sàng là dữ liệu lâm sàng của lượt khám → ghi audit "xem" (security-audit.md). entityId = encounterId (route không có id phiếu).
  @Get()
  @RequirePermission('clinical_order', 'read', { entityIdParam: 'encounterId' })
  @AuditView('clinical_order', { paramName: 'encounterId' })
  @UseInterceptors(AuditViewInterceptor)
  async get(@Param('encounterId', ParseUUIDPipe) encounterId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.get(tenantId, userId, req.dataScope!, encounterId);
  }

  @Put()
  @RequirePermission('clinical_order', 'create', { entityIdParam: 'encounterId' })
  async save(@Param('encounterId', ParseUUIDPipe) encounterId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveClinicalOrderRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.save(tenantId, userId, req.dataScope!, encounterId, dto, extractRequestMeta(req));
  }

  /** Ghi audit in phiếu chỉ định (web tự dựng bản in từ dữ liệu đã tải). */
  @Post('print')
  @RequirePermission('clinical_order', 'read', { entityIdParam: 'encounterId' })
  @HttpCode(200)
  async print(@Param('encounterId', ParseUUIDPipe) encounterId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    await this.service.recordPrint(tenantId, userId, req.dataScope!, encounterId, extractRequestMeta(req));
    return { ok: true };
  }
}
