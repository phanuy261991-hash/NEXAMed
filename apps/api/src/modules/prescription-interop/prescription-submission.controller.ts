import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { listInteropSubmissionsQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { requireBranchId } from '../../common/branch-context';
import { PrescriptionSubmissionService } from './prescription-submission.service';

/**
 * Hàng chờ gửi đơn thuốc lên cổng Đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3, mockup 8c). Xem danh sách: `encounter.read_clinical` (đơn thuốc là dữ liệu lâm sàng; bảng KHÔNG hiện tên bệnh nhân).
 * "Gửi ngay"/"Gửi lại": `prescription.sign` (cùng quyền người ký/đính chính đơn). Chỉ dòng của chi nhánh đang làm việc.
 */
@Controller('prescription-interop/submissions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PrescriptionSubmissionController {
  constructor(private readonly service: PrescriptionSubmissionService) {}

  @Get()
  @RequirePermission('encounter', 'read_clinical')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listInteropSubmissionsQuerySchema.parse(query);
    return this.service.list(req.user!.tenantId, requireBranchId(req.user!), dto);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermission('prescription', 'sign')
  async send(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.sendNow(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, 'SEND', extractRequestMeta(req));
  }

  /** "Gửi lại" sau lỗi: đặt lại số lần thử về 0 rồi gửi ngay. */
  @Post(':id/retry')
  @HttpCode(200)
  @RequirePermission('prescription', 'sign')
  async retry(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.sendNow(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, 'RETRY', extractRequestMeta(req));
  }
}
