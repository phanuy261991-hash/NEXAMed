import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createCashAccountRequestSchema, updateCashAccountRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { CashAccountService } from './cash-account.service';

/** "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — quản lý Quỹ (tiền mặt/ngân hàng). `read` mở cho mọi
 * vai trò lập phiếu (cần chọn quỹ), `manage` chỉ `clinic_admin` — đúng khuôn `reference_catalog`. */
@Controller('cash-accounts')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CashAccountController {
  constructor(private readonly cashAccountService: CashAccountService) {}

  @Get()
  @RequirePermission('cash_account', 'read')
  async list(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.cashAccountService.list(tenantId);
  }

  @Post()
  @RequirePermission('cash_account', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createCashAccountRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashAccountService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('cash_account', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateCashAccountRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashAccountService.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
