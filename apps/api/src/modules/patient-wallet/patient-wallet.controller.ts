import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  getPatientWalletQuerySchema,
  listWalletsQuerySchema,
  listWalletTransactionsQuerySchema,
  settleWalletRequestSchema,
  topUpWalletRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { PatientWalletService } from './patient-wallet.service';

/**
 * "Ví tạm ứng" — tài chính CỦA BỆNH NHÂN, không phải dữ liệu lâm sàng khẩn cấp nên KHÔNG gắn
 * `entityIdParam` cho break-glass (cùng lý do `CashVoucherController`). Đường dẫn dùng query param
 * (`?patientId=`) thay vì `:patientId` lồng trong path — tránh mọi rủi ro thứ tự route với các
 * hằng số cố định (`/transactions`, `/list`, `/topup`, `/settle`).
 */
@Controller('wallet')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientWalletController {
  constructor(private readonly walletService: PatientWalletService) {}

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

  @Post('topup')
  @RequirePermission('patient_wallet', 'topup')
  @HttpCode(200)
  async topUp(@Body() body: unknown, @Req() req: Request) {
    const dto = topUpWalletRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.walletService.topUp(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Post('settle')
  @RequirePermission('patient_wallet', 'settle')
  @HttpCode(200)
  async settle(@Body() body: unknown, @Req() req: Request) {
    const dto = settleWalletRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.walletService.settle(tenantId, userId, dto, extractRequestMeta(req));
  }
}
