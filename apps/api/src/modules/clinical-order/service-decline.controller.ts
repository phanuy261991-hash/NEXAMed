import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { declineQuoteRequestSchema, declinePreviewQuerySchema, declineServicesRequestSchema } from '@nexamed/shared';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { requireBranchId } from '../../common/branch-context';
import { ServiceDeclineService } from './service-decline.service';

/**
 * "Khách không làm dịch vụ" ở quầy thu ngân (docs/DECISIONS.md #280). Cùng tiền tố `billing/invoices/:encounterId` với các route hoá đơn khác nhưng thuộc module `clinical-order`
 * (module này sở hữu dòng chỉ định). Quyền HẸP `invoice.cancel_service` (lễ tân + quản lý phòng khám) — KHÔNG dùng `clinical_order.create`, vì quyền đó còn cho phép THÊM
 * chỉ định (hành vi lâm sàng, không phải việc của quầy). Máy chủ tự chọn nhánh gỡ dòng / hoàn tiền theo trạng thái phiếu nên một quyền phủ cả hai.
 */
@Controller('billing/invoices/:encounterId/service-decline')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ServiceDeclineController {
  constructor(private readonly service: ServiceDeclineService) {}

  /** Mở hộp thoại: dịch vụ liên quan tới phiếu + dòng nào bỏ được. Hiện tên dịch vụ đã chỉ định của bệnh nhân nên ghi nhật ký "xem". */
  @Get()
  @RequirePermission('invoice', 'cancel_service', { entityIdParam: 'encounterId' })
  @AuditView('clinical_order', { paramName: 'encounterId' })
  @UseInterceptors(AuditViewInterceptor)
  async preview(@Param('encounterId', ParseUUIDPipe) encounterId: string, @Query() query: unknown, @Req() req: Request) {
    const { invoiceId } = declinePreviewQuerySchema.parse(query);
    return this.service.preview(req.user!.tenantId, requireBranchId(req.user!), encounterId, invoiceId);
  }

  /** Số tiền hiện ở chân hộp thoại, tính lại mỗi lần tích chọn. Chỉ đọc. */
  @Post('quote')
  @HttpCode(200)
  @RequirePermission('invoice', 'cancel_service', { entityIdParam: 'encounterId' })
  async quote(@Param('encounterId', ParseUUIDPipe) encounterId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = declineQuoteRequestSchema.parse(body);
    return this.service.quote(req.user!.tenantId, requireBranchId(req.user!), encounterId, dto);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('invoice', 'cancel_service', { entityIdParam: 'encounterId' })
  async decline(@Param('encounterId', ParseUUIDPipe) encounterId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = declineServicesRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.decline(tenantId, requireBranchId(req.user!), userId, encounterId, dto, extractRequestMeta(req));
  }
}
