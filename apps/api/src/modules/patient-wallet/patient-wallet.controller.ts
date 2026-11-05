import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  exportWalletsQuerySchema,
  getPatientWalletQuerySchema,
  listWalletsQuerySchema,
  listWalletTransactionsQuerySchema,
  settleWalletRequestSchema,
  topUpWalletRequestSchema,
} from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { PatientWalletExportService } from './patient-wallet-export.service';
import { PatientWalletService } from './patient-wallet.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * "Ví tạm ứng" — tài chính CỦA BỆNH NHÂN, không phải dữ liệu lâm sàng khẩn cấp nên KHÔNG gắn
 * `entityIdParam` cho break-glass (cùng lý do `CashVoucherController`). Đường dẫn dùng query param
 * (`?patientId=`) thay vì `:patientId` lồng trong path — tránh mọi rủi ro thứ tự route với các
 * hằng số cố định (`/transactions`, `/list`, `/topup`, `/settle`).
 */
@Controller('wallet')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientWalletController {
  constructor(
    private readonly walletService: PatientWalletService,
    private readonly exportService: PatientWalletExportService,
  ) {}

  @Get()
  @RequirePermission('patient', 'read')
  async get(@Query() query: unknown, @Req() req: Request) {
    const dto = getPatientWalletQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.walletService.getWallet(tenantId, dto.patientId);
  }

  @Get('transactions')
  @RequirePermission('patient', 'read')
  async listTransactions(@Query() query: unknown, @Req() req: Request) {
    const dto = listWalletTransactionsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.walletService.listTransactions(tenantId, dto.patientId, dto);
  }

  @Get('list')
  @RequirePermission('patient_wallet', 'settle')
  async listWallets(@Query() query: unknown, @Req() req: Request) {
    const dto = listWalletsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.walletService.listWallets(tenantId, dto);
  }

  /** Xuất Excel "Ví tạm ứng" đúng bộ lọc đang xem (docs/DECISIONS.md #287) — cùng quyền `patient_wallet.settle` với danh sách; ghi nhật ký xuất. Route cố định, không có tham số trong đường dẫn. */
  @Get('export')
  @RequirePermission('patient_wallet', 'settle')
  async exportWallets(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = exportWalletsQuerySchema.parse(query);
    const buffer = await this.exportService.exportExcel(req.user!, dto);
    await this.exportService.recordExportAudit(req.user!, dto, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="vi-tam-ung.xlsx"');
    res.send(buffer);
  }

  @Post('topup')
  @RequirePermission('patient_wallet', 'topup')
  @HttpCode(200)
  async topUp(@Body() body: unknown, @Req() req: Request) {
    const dto = topUpWalletRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.walletService.topUp(tenantId, requireBranchId(req.user!), userId, dto, extractRequestMeta(req));
  }

  @Post('settle')
  @RequirePermission('patient_wallet', 'settle')
  @HttpCode(200)
  async settle(@Body() body: unknown, @Req() req: Request) {
    const dto = settleWalletRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.walletService.settle(tenantId, requireBranchId(req.user!), userId, dto, extractRequestMeta(req));
  }
}
