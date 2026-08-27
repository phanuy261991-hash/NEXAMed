import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { listBillingInvoicesQuerySchema, markInvoicePaidRequestSchema, revertInvoicePaymentRequestSchema, saveInvoiceDraftRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { InvoiceService } from './invoice.service';

/** Thu ngân cơ bản (Sprint 5/6, BIL-01→04) — tạo phiếu thu (BIL-01) thuộc `reception.controller.ts` (tự động lúc tiếp nhận), không phải đây. */
@Controller('billing/invoices')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  /** "Thu ngân" (danh sách trong ngày) + tổng kết cuối ngày (BIL-04) — cùng 1 response. */
  @Get()
  @RequirePermission('invoice', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listBillingInvoicesQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.invoiceService.listForDay(tenantId, dto.date);
  }

  @Get(':encounterId')
  @RequirePermission('invoice', 'read', { entityIdParam: 'encounterId' })
  async get(@Param('encounterId') encounterId: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.invoiceService.getByEncounterId(tenantId, encounterId);
  }

  @Post(':encounterId/pay')
  @RequirePermission('invoice', 'update', { entityIdParam: 'encounterId' })
  @HttpCode(200)
  async pay(@Param('encounterId') encounterId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = markInvoicePaidRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.invoiceService.markPaid(tenantId, userId, encounterId, dto, extractRequestMeta(req));
  }

  @Post(':encounterId/revert-payment')
  @RequirePermission('invoice', 'update', { entityIdParam: 'encounterId' })
  @HttpCode(200)
  async revertPayment(@Param('encounterId') encounterId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = revertInvoicePaymentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.invoiceService.revertPayment(tenantId, userId, encounterId, dto, extractRequestMeta(req));
  }

  /** "Lưu tạm" (F8) — phương thức/tiền khách đưa đang nhập dở, chưa "Thu tiền". */
  @Post(':encounterId/save-draft')
  @RequirePermission('invoice', 'update', { entityIdParam: 'encounterId' })
  @HttpCode(200)
  async saveDraft(@Param('encounterId') encounterId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveInvoiceDraftRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.invoiceService.saveDraft(tenantId, userId, encounterId, dto, extractRequestMeta(req));
  }

  /** In phiếu thu (BIL-02) — ghi nhận `printedAt`, idempotent. Bố cục in nằm ở tầng web. */
  @Post(':encounterId/print')
  @RequirePermission('invoice', 'print', { entityIdParam: 'encounterId' })
  @HttpCode(200)
  async print(@Param('encounterId') encounterId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.invoiceService.markPrinted(tenantId, userId, encounterId, extractRequestMeta(req));
  }
}
