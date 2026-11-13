import { Body, Controller, Get, HttpCode, Param, Post, Patch, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  addStockRequestLinesRequestSchema,
  allocateStockRequestRequestSchema,
  cancelStockRequestRequestSchema,
  createStockRequestRequestSchema,
  escalateStockRequestRequestSchema,
  getStockRequestLowStockQuerySchema,
  listStockRequestsQuerySchema,
  rejectStockRequestRequestSchema,
  resolveStockRequestWithdrawRequestSchema,
  updateStockRequestNoteRequestSchema,
  updateStockRequestRequestSchema,
  versionedStockRequestRequestSchema,
  withdrawStockRequestLinesRequestSchema,
} from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { extractRequestMeta } from '../../common/request-meta';
import { StockRequestExportService } from './stock-request-export.service';
import { StockRequestService } from './stock-request.service';

/**
 * "Phiếu yêu cầu cấp hàng" (docs/DECISIONS.md #298) — không gắn `entityIdParam` cho break-glass (dữ liệu vận hành kho, không phải lâm sàng khẩn cấp), cùng lý do `stock_transfer`.
 * Quyền: `create` cho bên xin, `approve` cho kho cấp; mọi handler đọc `req.dataScope!` và Service tự kiểm đúng kho theo phạm vi Khoa/Phòng. Route tĩnh đặt TRƯỚC `:id`.
 */
@Controller('inventory/requests')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class StockRequestController {
  constructor(
    private readonly stockRequestService: StockRequestService,
    private readonly exportService: StockRequestExportService,
  ) {}

  @Get()
  @RequirePermission('stock_request', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listStockRequestsQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.list(tenantId, requireBranchId(req.user!), userId, req.dataScope!, dto);
  }

  /** Chấm số trên menu "Yêu cầu cấp hàng". */
  @Get('pending-counts')
  @RequirePermission('stock_request', 'read')
  async pendingCounts(@Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.getPendingCounts(tenantId, requireBranchId(req.user!), userId, req.dataScope!);
  }

  /** Các kho được phép xin kèm kho cấp suy ra theo cấp. */
  @Get('options')
  @RequirePermission('stock_request', 'create')
  async options(@Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.getOptions(tenantId, requireBranchId(req.user!), userId, req.dataScope!);
  }

  /** "Thêm các mặt hàng dưới mức tồn tối thiểu". */
  @Get('low-stock')
  @RequirePermission('stock_request', 'create')
  async lowStock(@Query() query: unknown, @Req() req: Request) {
    const dto = getStockRequestLowStockQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.getLowStock(tenantId, requireBranchId(req.user!), userId, req.dataScope!, dto.warehouseId);
  }

  /** Tab "Hàng cần bổ sung" (mockup màn 4) của kho chính chi nhánh đang làm. */
  @Get('restock')
  @RequirePermission('stock_request', 'create')
  async restock(@Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.getRestock(tenantId, requireBranchId(req.user!), userId, req.dataScope!);
  }

  /** "Xuất Excel" danh sách — cùng quyền xem, ghi nhật ký xuất. */
  @Get('export')
  @RequirePermission('stock_request', 'read')
  async exportList(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = listStockRequestsQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    const branchId = requireBranchId(req.user!);
    const { items } = await this.stockRequestService.listAllForExport(tenantId, branchId, userId, req.dataScope!, dto);
    const multiBranch = new Set(items.flatMap((i) => [i.requestingBranchId, i.supplyingBranchId])).size > 1;
    const buffer = await this.exportService.buildListExcel(dto.view, items, multiBranch);
    await this.stockRequestService.recordExportAudit(tenantId, userId, dto, extractRequestMeta(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="yeu-cau-cap-hang-${dto.view === 'mine' ? 'cua-toi' : 'can-duyet'}.xlsx"`);
    res.send(buffer);
  }

  @Get(':id')
  @RequirePermission('stock_request', 'read')
  @AuditView('stock_request')
  @UseInterceptors(AuditViewInterceptor)
  async get(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.getById(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id);
  }

  @Post()
  @RequirePermission('stock_request', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createStockRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.create(tenantId, requireBranchId(req.user!), userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('stock_request', 'create')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateStockRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.update(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** Kho cấp xác nhận / từ chối "Yêu cầu rút" của bên xin (đơn đặt hàng NCC đã gửi nhà cung cấp). */
  @Post(':id/withdraw-requests/resolve')
  @RequirePermission('stock_request', 'approve')
  @HttpCode(200)
  async resolveWithdrawRequests(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = resolveStockRequestWithdrawRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.resolveWithdrawRequests(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/submit')
  @RequirePermission('stock_request', 'create')
  @HttpCode(200)
  async submit(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = versionedStockRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.submit(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/cancel')
  @RequirePermission('stock_request', 'create')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = cancelStockRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.cancel(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** Nhắn bổ sung / đổi mức khẩn / đổi ngày cần. */
  @Post(':id/note')
  @RequirePermission('stock_request', 'create')
  @HttpCode(200)
  async note(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateStockRequestNoteRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.updateNote(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/lines')
  @RequirePermission('stock_request', 'create')
  @HttpCode(200)
  async addLines(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = addStockRequestLinesRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.addLines(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/withdraw-lines')
  @RequirePermission('stock_request', 'create')
  @HttpCode(200)
  async withdrawLines(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = withdrawStockRequestLinesRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.withdrawLines(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/accept')
  @RequirePermission('stock_request', 'approve')
  @HttpCode(200)
  async accept(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = versionedStockRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.accept(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/reject')
  @RequirePermission('stock_request', 'approve')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectStockRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.reject(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/acknowledge-update')
  @RequirePermission('stock_request', 'approve')
  @HttpCode(200)
  async acknowledgeUpdate(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.acknowledgeUpdate(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, extractRequestMeta(req));
  }

  /** "Chuyển thành phiếu điều chuyển" / "Cấp tiếp". */
  @Post(':id/allocate')
  @RequirePermission('stock_request', 'approve')
  @HttpCode(200)
  async allocate(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = allocateStockRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.allocate(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** "Xin phần thiếu từ chi nhánh chính" / lên kho cấp trên. */
  @Post(':id/escalate')
  @RequirePermission('stock_request', 'approve')
  @HttpCode(200)
  async escalate(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = escalateStockRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockRequestService.escalate(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }
}
