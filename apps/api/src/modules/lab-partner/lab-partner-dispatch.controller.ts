import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { listLabPartnerQueueQuerySchema, sendLabPartnerSamplesRequestSchema } from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { LabPartnerDispatchService } from './lab-partner-dispatch.service';

/**
 * Hàng đợi "Gửi mẫu đối tác" (docs/DECISIONS.md #291) — theo CHI NHÁNH đang làm việc. `lab_partner.read` xem hàng đợi, `lab_partner.send` gửi mẫu đi.
 * Giá trả đối tác chỉ có số khi người gọi thấy được giá vốn (xem `canSeePartnerCost`); công tắc "Dùng đối tác xét nghiệm" tắt thì mọi route trả 409.
 */
@Controller('lab-partner-dispatch')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LabPartnerDispatchController {
  constructor(private readonly service: LabPartnerDispatchService) {}

  @Get('pending')
  @RequirePermission('lab_partner', 'read')
  async pending(@Query() query: unknown, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.service.listPending(tenantId, userId, requireBranchId(req.user!), listLabPartnerQueueQuerySchema.parse(query));
  }

  @Get('sent')
  @RequirePermission('lab_partner', 'read')
  async sent(@Query() query: unknown, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.service.listSent(tenantId, userId, requireBranchId(req.user!), listLabPartnerQueueQuerySchema.parse(query));
  }

  @Post()
  @RequirePermission('lab_partner', 'send')
  @HttpCode(200)
  async send(@Body() body: unknown, @Req() req: Request) {
    const dto = sendLabPartnerSamplesRequestSchema.parse(body);
    const { tenantId, userId } = req.user!;
    return this.service.send(tenantId, userId, requireBranchId(req.user!), dto, extractRequestMeta(req));
  }
}
