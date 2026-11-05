import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { doctorReportQuerySchema, type DoctorReportQuery } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import type { ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildDoctorHoursExcel, buildDoctorOrderMixExcel, buildDoctorPerformanceExcel, type DoctorExcelContext } from './doctor-report-export';
import { DoctorReportService } from './doctor-report.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Trang báo cáo "Bác sĩ" (docs/DECISIONS.md #287): Hiệu suất theo bác sĩ, Cơ cấu kê đơn và chỉ định, Giờ làm việc và lượt khám — mỗi báo cáo có một route xem và một route `…/export` (Excel).
 * Quyền: `doctor_report.read` (mặc định chỉ quản lý phòng khám). Gộp từ hai chi nhánh trở lên cần THÊM `company_report.read` — `ReportBranchScopeService` kiểm trong service, thiếu quyền → 403 dù
 * client tự gửi `scope=all`. Route cố định, không có route tham số.
 */
@Controller('reports/doctors')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DoctorReportController {
  constructor(private readonly service: DoctorReportService) {}

  private async exportReport<T extends { from: string; to: string }>(
    req: Request,
    res: Response,
    dto: DoctorReportQuery,
    reportName: string,
    fileStem: string,
    load: (now: Date) => Promise<{ report: T; scope: ReportBranchScope }>,
    build: (report: T, ctx: DoctorExcelContext) => Promise<Buffer>,
  ): Promise<void> {
    const now = new Date();
    const { report, scope } = await load(now);
    const [base, departmentLabel] = await Promise.all([this.service.exportContext(req.user!, scope, now), this.service.departmentLabel(req.user!, dto.departmentId)]);
    const buffer = await build(report, { ...base, departmentLabel });
    await this.service.recordExportAudit(req.user!, reportName, report, scope.branchIds, extractRequestMeta(req), { departmentFiltered: !!dto.departmentId });
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${fileStem}-${report.from}-${report.to}.xlsx"`);
    res.send(buffer);
  }

  @Get('performance')
  @RequirePermission('doctor_report', 'read')
  async performance(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getPerformance(req.user!, doctorReportQuerySchema.parse(query))).report;
  }

  @Get('performance/export')
  @RequirePermission('doctor_report', 'read')
  async performanceExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = doctorReportQuerySchema.parse(query);
    await this.exportReport(req, res, dto, 'performance', 'hieu-suat-bac-si', (now) => this.service.getPerformance(req.user!, dto, now), buildDoctorPerformanceExcel);
  }

  @Get('order-mix')
  @RequirePermission('doctor_report', 'read')
  async orderMix(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getOrderMix(req.user!, doctorReportQuerySchema.parse(query))).report;
  }

  @Get('order-mix/export')
  @RequirePermission('doctor_report', 'read')
  async orderMixExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = doctorReportQuerySchema.parse(query);
    await this.exportReport(req, res, dto, 'order_mix', 'co-cau-ke-don-chi-dinh', (now) => this.service.getOrderMix(req.user!, dto, now), buildDoctorOrderMixExcel);
  }

  @Get('hours')
  @RequirePermission('doctor_report', 'read')
  async hours(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getHours(req.user!, doctorReportQuerySchema.parse(query))).report;
  }

  @Get('hours/export')
  @RequirePermission('doctor_report', 'read')
  async hoursExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = doctorReportQuerySchema.parse(query);
    await this.exportReport(req, res, dto, 'hours', 'gio-lam-viec-luot-kham', (now) => this.service.getHours(req.user!, dto, now), buildDoctorHoursExcel);
  }
}
