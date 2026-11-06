import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { patientReportQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import type { ReportBranchScope } from '../../common/report-branch-scope.service';
import type { ReportExportContext } from '../../common/report-export-support';
import { buildPatientDemographicsExcel, buildPatientNewReturningExcel, buildPatientNotReturningExcel } from './patient-report-export';
import { PatientReportService } from './patient-report.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Trang báo cáo "Bệnh nhân" (docs/DECISIONS.md #287): Bệnh nhân mới và cũ, Tuổi giới và địa bàn, Bệnh nhân không quay lại — mỗi báo cáo có một route xem và một route `…/export` (Excel).
 * Quyền: `patient_report.read` (mặc định chỉ quản lý phòng khám). Gộp từ hai chi nhánh trở lên cần THÊM `company_report.read` — `ReportBranchScopeService` kiểm trong service, thiếu quyền
 * → 403 dù client tự gửi `scope=all`. Route cố định, không có route tham số.
 */
@Controller('reports/patients')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientReportController {
  constructor(private readonly service: PatientReportService) {}

  private async exportReport<T extends { from: string; to: string }>(
    req: Request,
    res: Response,
    reportName: string,
    fileStem: string,
    load: (now: Date) => Promise<{ report: T; scope: ReportBranchScope }>,
    build: (report: T, ctx: ReportExportContext) => Promise<Buffer>,
  ): Promise<void> {
    const now = new Date();
    const { report, scope } = await load(now);
    const ctx = await this.service.exportContext(req.user!, scope, now);
    const buffer = await build(report, ctx);
    await this.service.recordExportAudit(req.user!, reportName, report, scope.branchIds, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${fileStem}-${report.from}-${report.to}.xlsx"`);
    res.send(buffer);
  }

  @Get('new-returning')
  @RequirePermission('patient_report', 'read')
  async newReturning(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getNewReturning(req.user!, patientReportQuerySchema.parse(query))).report;
  }

  @Get('new-returning/export')
  @RequirePermission('patient_report', 'read')
  async newReturningExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = patientReportQuerySchema.parse(query);
    await this.exportReport(req, res, 'new_returning', 'benh-nhan-moi-va-cu', (now) => this.service.getNewReturning(req.user!, dto, now), buildPatientNewReturningExcel);
  }

  @Get('demographics')
  @RequirePermission('patient_report', 'read')
  async demographics(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getDemographics(req.user!, patientReportQuerySchema.parse(query))).report;
  }

  @Get('demographics/export')
  @RequirePermission('patient_report', 'read')
  async demographicsExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = patientReportQuerySchema.parse(query);
    await this.exportReport(req, res, 'demographics', 'tuoi-gioi-dia-ban', (now) => this.service.getDemographics(req.user!, dto, now), buildPatientDemographicsExcel);
  }

  @Get('not-returning')
  @RequirePermission('patient_report', 'read')
  async notReturning(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getNotReturning(req.user!, patientReportQuerySchema.parse(query))).report;
  }

  @Get('not-returning/export')
  @RequirePermission('patient_report', 'read')
  async notReturningExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = patientReportQuerySchema.parse(query);
    await this.exportReport(req, res, 'not_returning', 'benh-nhan-khong-quay-lai', (now) => this.service.getNotReturning(req.user!, dto, now), buildPatientNotReturningExcel);
  }
}
