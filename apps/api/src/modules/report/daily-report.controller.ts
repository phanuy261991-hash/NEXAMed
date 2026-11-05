import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { dailyReportQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { DailyReportService } from './daily-report.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * "Báo cáo ngày" (docs/DECISIONS.md #287). Quyền xem: `daily_report.read` (mặc định chỉ quản trị phòng khám). Gộp từ hai chi nhánh trở lên cần THÊM `company_report.read` —
 * `ReportBranchScopeService` kiểm trong service, thiếu quyền → 403 dù client tự gửi `scope=all`.
 */
@Controller('reports/daily')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DailyReportController {
  constructor(private readonly dailyReportService: DailyReportService) {}

  @Get()
  @RequirePermission('daily_report', 'read')
  async get(@Query() query: unknown, @Req() req: Request) {
    return this.dailyReportService.getReport(req.user!, dailyReportQuerySchema.parse(query));
  }

  @Get('export')
  @RequirePermission('daily_report', 'read')
  async export(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = dailyReportQuerySchema.parse(query);
    const { buffer, scope, date } = await this.dailyReportService.exportExcel(req.user!, dto);
    await this.dailyReportService.recordExportAudit(req.user!, dto, scope.branchIds, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-ngay-${date}.xlsx"`);
    res.send(buffer);
  }
}
