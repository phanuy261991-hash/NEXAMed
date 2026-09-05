import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import {
  approveCashVoucherRequestSchema,
  createCashVoucherRequestSchema,
  listCashVouchersQuerySchema,
  rejectCashVoucherRequestSchema,
  updateCashVoucherRequestSchema,
  voidCashVoucherRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { extractRequestMeta } from '../../common/request-meta';
import { CashVoucherService } from './cash-voucher.service';

/**
 * "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — Phiếu thu/chi ngoài dịch vụ khám. KHÔNG gắn
 * `entityIdParam` cho break-glass (khác `patient`/`encounter`) — đây là dữ liệu TÀI CHÍNH không
 * phải lâm sàng khẩn cấp, không có lý do nghiệp vụ để bỏ qua RBAC bằng phá kính.
 */
@Controller('cash-vouchers')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CashVoucherController {
  constructor(private readonly cashVoucherService: CashVoucherService) {}

  @Get()
  @RequirePermission('cash_voucher', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listCashVouchersQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.cashVoucherService.list(tenantId, dto);
  }

  @Get(':id')
  @RequirePermission('cash_voucher', 'read')
  @AuditView('cash_voucher')
  @UseInterceptors(AuditViewInterceptor)
  async get(@Param('id') id: string, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.cashVoucherService.getById(tenantId, req.dataScope!, userId, id);
  }

  @Post()
  @RequirePermission('cash_voucher', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createCashVoucherRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashVoucherService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('cash_voucher', 'update')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateCashVoucherRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashVoucherService.update(tenantId, req.dataScope!, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/void')
  @RequirePermission('cash_voucher', 'update')
  @HttpCode(200)
  async voidVoucher(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = voidCashVoucherRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashVoucherService.voidVoucher(tenantId, req.dataScope!, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/approve')
  @RequirePermission('cash_voucher', 'approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = approveCashVoucherRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashVoucherService.approve(tenantId, userId, id, dto.version, extractRequestMeta(req));
  }

  @Post(':id/reject')
  @RequirePermission('cash_voucher', 'approve')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectCashVoucherRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashVoucherService.reject(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/print')
  @RequirePermission('cash_voucher', 'read')
  @HttpCode(200)
  async print(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.cashVoucherService.markPrinted(tenantId, req.dataScope!, userId, id, extractRequestMeta(req));
  }
}
