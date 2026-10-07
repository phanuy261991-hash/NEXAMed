import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { listParaclinicalQueueQuerySchema, saveParaclinicalResultRequestSchema, startParaclinicalItemsRequestSchema } from '@nexamed/shared';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ParaclinicalResultService } from './paraclinical-result.service';

/**
 * Hàng đợi + thực hiện + nhập/duyệt kết quả cận lâm sàng (Cận lâm sàng GĐ4 đợt 1, docs/DECISIONS.md #212). Quyền TÁCH HAI: `enter` (lấy mẫu/gọi vào phòng, lưu nháp, gửi duyệt —
 * kỹ thuật viên, điều dưỡng, bác sĩ) và `approve` (duyệt & trả kết quả = ký — bác sĩ/clinic_admin) để kỹ thuật viên không tự ký kết quả.
 * Không có data_scope theo chủ sở hữu: kết quả thuộc phòng khám, ai có quyền đều làm việc trên toàn bộ hàng đợi.
 */
@Controller('paraclinical')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ParaclinicalResultController {
  constructor(private readonly service: ParaclinicalResultService) {}

  @Get('queue')
  @RequirePermission('paraclinical_result', 'read')
  async queue(@Query() query: unknown, @Req() req: Request) {
    return this.service.listQueue(req.user!.tenantId, listParaclinicalQueueQuerySchema.parse(query));
  }

  /** "Lấy mẫu" / "Gọi vào phòng" — các dòng cùng phiếu chuyển sang "Đang thực hiện". */
  @Post('start')
  @RequirePermission('paraclinical_result', 'enter')
  @HttpCode(200)
  async start(@Body() body: unknown, @Req() req: Request) {
    const dto = startParaclinicalItemsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.startItems(tenantId, userId, dto, extractRequestMeta(req));
  }

  // Kết quả cận lâm sàng là dữ liệu lâm sàng → ghi audit "xem" (security-audit.md). entityId = id dòng chỉ định mở màn.
  @Get('items/:itemId/result')
  @RequirePermission('paraclinical_result', 'read')
  @AuditView('paraclinical_result', { paramName: 'itemId' })
  @UseInterceptors(AuditViewInterceptor)
  async getResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return { form: await this.service.getForm(tenantId, userId, itemId) };
  }

  @Put('items/:itemId/result')
  @RequirePermission('paraclinical_result', 'enter')
  async saveResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveParaclinicalResultRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { form: await this.service.save(tenantId, userId, itemId, dto, extractRequestMeta(req)) };
  }

  @Post('items/:itemId/result/approve')
  @RequirePermission('paraclinical_result', 'approve')
  @HttpCode(200)
  async approveResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveParaclinicalResultRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { form: await this.service.approve(tenantId, userId, itemId, dto, extractRequestMeta(req)) };
  }
}
