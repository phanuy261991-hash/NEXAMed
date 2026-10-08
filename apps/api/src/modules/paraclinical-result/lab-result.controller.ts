import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { PARACLINICAL_GROUP_KINDS, PARACLINICAL_GROUP_PERMISSION_MODULE } from '@nexamed/core';
import { amendParaclinicalResultRequestSchema, listParaclinicalQueueQuerySchema, saveParaclinicalResultRequestSchema, startParaclinicalItemsRequestSchema } from '@nexamed/shared';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ParaclinicalResultService, type ResultAccessScope } from './paraclinical-result.service';

const scopeOf = (req: Request): ResultAccessScope => ({ dataScope: req.dataScope!, kinds: PARACLINICAL_GROUP_KINDS.lab, permissionModule: PARACLINICAL_GROUP_PERMISSION_MODULE.lab });

/**
 * Menu "Xét nghiệm" — hàng đợi, lấy mẫu, nhập + duyệt kết quả xét nghiệm (Cận lâm sàng GĐ4, docs/DECISIONS.md #212; tách 2 menu #215). Quyền `lab_result.*`, chỉ phục vụ dịch vụ loại LAB.
 * Quyền TÁCH HAI: `enter` (lấy mẫu, lưu nháp, gửi duyệt — kỹ thuật viên, điều dưỡng, bác sĩ) và `approve` (duyệt & trả kết quả = ký — bác sĩ/clinic_admin) để kỹ thuật viên không tự ký.
 * Cùng service với `ImagingResultController`; khác nhau ở quyền và nhóm dịch vụ (`ResultAccessScope.kinds`).
 */
@Controller('paraclinical/lab')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LabResultController {
  constructor(private readonly service: ParaclinicalResultService) {}

  @Get('queue')
  @RequirePermission('lab_result', 'read')
  async queue(@Query() query: unknown, @Req() req: Request) {
    return this.service.listQueue(req.user!.tenantId, req.user!.userId, scopeOf(req), listParaclinicalQueueQuerySchema.parse(query));
  }

  /** "Lấy mẫu" — các dòng cùng phiếu chuyển sang "Đang thực hiện". */
  @Post('start')
  @RequirePermission('lab_result', 'enter')
  @HttpCode(200)
  async start(@Body() body: unknown, @Req() req: Request) {
    const dto = startParaclinicalItemsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.startItems(tenantId, userId, scopeOf(req), dto, extractRequestMeta(req));
  }

  // Kết quả cận lâm sàng là dữ liệu lâm sàng → ghi audit "xem" (security-audit.md). entityId = id dòng chỉ định mở màn.
  @Get('items/:itemId/result')
  @RequirePermission('lab_result', 'read')
  @AuditView('paraclinical_result', { paramName: 'itemId' })
  @UseInterceptors(AuditViewInterceptor)
  async getResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return { form: await this.service.getForm(tenantId, userId, scopeOf(req), itemId) };
  }

  @Put('items/:itemId/result')
  @RequirePermission('lab_result', 'enter')
  async saveResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveParaclinicalResultRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { form: await this.service.save(tenantId, userId, scopeOf(req), itemId, dto, extractRequestMeta(req)) };
  }

  /** Ghi audit in phiếu kết quả (web tự dựng bản in từ dữ liệu đã tải). */
  @Post('items/:itemId/result/print')
  @RequirePermission('lab_result', 'read')
  @HttpCode(200)
  async printResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    await this.service.recordPrint(tenantId, userId, scopeOf(req), itemId, extractRequestMeta(req));
    return { ok: true };
  }

  /** "Đính chính" kết quả đã duyệt: đề nghị kèm lý do (quyền Nhập của nhóm), bác sĩ có quyền Duyệt ký lại. */
  @Post('items/:itemId/result/amend')
  @RequirePermission('lab_result', 'enter')
  @HttpCode(200)
  async amendResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = amendParaclinicalResultRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { form: await this.service.startAmendment(tenantId, userId, scopeOf(req), itemId, dto, extractRequestMeta(req)) };
  }

  /** Huỷ đính chính đang soạn/chờ duyệt — khôi phục bản đã duyệt cũ. */
  @Post('items/:itemId/result/amend/cancel')
  @RequirePermission('lab_result', 'enter')
  @HttpCode(200)
  async cancelAmendment(@Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return { form: await this.service.cancelAmendment(tenantId, userId, scopeOf(req), itemId, extractRequestMeta(req)) };
  }

  @Post('items/:itemId/result/approve')
  @RequirePermission('lab_result', 'approve')
  @HttpCode(200)
  async approveResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveParaclinicalResultRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { form: await this.service.approve(tenantId, userId, scopeOf(req), itemId, dto, extractRequestMeta(req)) };
  }
}
