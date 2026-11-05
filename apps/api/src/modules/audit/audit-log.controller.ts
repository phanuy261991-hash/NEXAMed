import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { exportAuditLogQuerySchema, listAuditLogQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { AuditLogExportService } from './audit-log-export.service';
import { AuditLogService } from './audit-log.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('audit-log')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AuditLogController {
  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly exportService: AuditLogExportService,
  ) {}

  /** Xuất Excel "Nhật ký kiểm toán" đúng bộ lọc đang xem (docs/DECISIONS.md #287) — cùng quyền `audit_log.read`; việc xuất cũng được ghi vào nhật ký. */
  @Get('export')
  @RequirePermission('audit_log', 'read')
  async export(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = exportAuditLogQuerySchema.parse(query);
    const buffer = await this.exportService.exportExcel(req.user!, dto);
    await this.exportService.recordExportAudit(req.user!, dto, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="nhat-ky-kiem-toan.xlsx"');
    res.send(buffer);
  }

  @Get()
  @RequirePermission('audit_log', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listAuditLogQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.auditLogService.list(tenantId, dto);
  }
}
