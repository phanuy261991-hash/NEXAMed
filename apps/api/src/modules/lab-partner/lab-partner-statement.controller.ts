import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { labPartnerStatementQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { LabPartnerStatementService } from './lab-partner-statement.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Bảng kê mẫu xét nghiệm gửi đối tác (docs/DECISIONS.md #291, GĐ4) — chứng từ công nợ nên cùng quyền `supplier_debt.read` với trang chi tiết nhà cung cấp/đối tác. Chung cả công ty
 * (không theo chi nhánh đang làm việc, như sổ công nợ). Công tắc "Dùng đối tác xét nghiệm" tắt thì trả 409.
 */
@Controller('lab-partner-statement')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LabPartnerStatementController {
  constructor(private readonly service: LabPartnerStatementService) {}

  @Get(':supplierId/pending-summary')
  @RequirePermission('supplier_debt', 'read')
  async pendingSummary(@Param('supplierId') supplierId: string, @Req() req: Request) {
    return this.service.getPendingSummary(req.user!.tenantId, supplierId);
  }

  @Get(':supplierId/export')
  @RequirePermission('supplier_debt', 'read')
  async exportExcel(@Param('supplierId') supplierId: string, @Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = labPartnerStatementQuerySchema.parse(query);
    const actor = { tenantId: req.user!.tenantId, userId: req.user!.userId };
    const buffer = await this.service.exportExcel(actor, supplierId, dto);
    await this.service.recordExportAudit(actor, supplierId, dto, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="bang-ke-mau-gui-doi-tac.xlsx"');
    res.send(buffer);
  }

  @Get(':supplierId')
  @RequirePermission('supplier_debt', 'read')
  async statement(@Param('supplierId') supplierId: string, @Query() query: unknown, @Req() req: Request) {
    return this.service.getStatement(req.user!.tenantId, supplierId, labPartnerStatementQuerySchema.parse(query));
  }
}
