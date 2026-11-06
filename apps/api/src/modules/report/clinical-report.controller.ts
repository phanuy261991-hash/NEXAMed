import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { clinicalReportQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import type { ReportBranchScope } from '../../common/report-branch-scope.service';
import type { ReportExportContext } from '../../common/report-export-support';
import { buildClinicalDiagnosisExcel, buildClinicalParaclinicalExcel } from './clinical-report-export';
import { ClinicalReportService } from './clinical-report.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Trang báo cáo "Chuyên môn" (docs/DECISIONS.md #287): Cơ cấu chẩn đoán ICD-10 và Cận lâm sàng — mỗi báo cáo có một route xem và một route `…/export` (Excel). Tab "Dịch vụ đã dùng" của trang
 * dẫn sang báo cáo Doanh thu "Theo nhóm và dịch vụ" nên không có route ở đây. Quyền: `clinical_report.read` (mặc định chỉ quản lý phòng khám). Gộp từ hai chi nhánh trở lên cần THÊM
 * `company_report.read` — `ReportBranchScopeService` kiểm trong service, thiếu quyền → 403 dù client tự gửi `scope=all`. Route cố định, không có route tham số.
 */
@Controller('reports/clinical')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ClinicalReportController {
  constructor(private readonly service: ClinicalReportService) {}

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

  @Get('diagnoses')
  @RequirePermission('clinical_report', 'read')
  async diagnoses(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getDiagnoses(req.user!, clinicalReportQuerySchema.parse(query))).report;
  }

  @Get('diagnoses/export')
  @RequirePermission('clinical_report', 'read')
  async diagnosesExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = clinicalReportQuerySchema.parse(query);
    await this.exportReport(req, res, 'diagnoses', 'co-cau-chan-doan-icd10', (now) => this.service.getDiagnoses(req.user!, dto, now), buildClinicalDiagnosisExcel);
  }

  @Get('paraclinical')
  @RequirePermission('clinical_report', 'read')
  async paraclinical(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getParaclinical(req.user!, clinicalReportQuerySchema.parse(query))).report;
  }

  @Get('paraclinical/export')
  @RequirePermission('clinical_report', 'read')
  async paraclinicalExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = clinicalReportQuerySchema.parse(query);
    await this.exportReport(req, res, 'paraclinical', 'can-lam-sang', (now) => this.service.getParaclinical(req.user!, dto, now), buildClinicalParaclinicalExcel);
  }
}
