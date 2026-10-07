import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  createPriceListRequestSchema,
  listPriceListsQuerySchema,
  lookupPriceQuerySchema,
  resolvePricesRequestSchema,
  searchPriceableItemsQuerySchema,
  updatePriceListRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { PriceListExportService } from './price-list-export.service';
import { PriceListService } from './price-list.service';
import { PricingService } from './pricing.service';

/**
 * Bảng giá có thời hạn + tính giá áp dụng (Cận lâm sàng GĐ2, docs/DECISIONS.md #212). `price_list.read` mở cho mọi vai trò
 * cần tra giá (lễ tân lúc tiếp nhận, bác sĩ lúc chỉ định, "Tra thử giá"); tạo/sửa/ngừng chỉ clinic_admin.
 * Các route tĩnh (`items/search`, `lookup`, `resolve`) khai báo TRƯỚC `:id` — Express khớp theo thứ tự khai báo.
 */
@Controller('price-lists')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PriceListController {
  constructor(
    private readonly service: PriceListService,
    private readonly pricing: PricingService,
    private readonly exporter: PriceListExportService,
  ) {}

  @Get()
  @RequirePermission('price_list', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    return this.service.list(req.user!.tenantId, listPriceListsQuerySchema.parse(query));
  }

  @Get('items/search')
  @RequirePermission('price_list', 'read')
  async searchItems(@Query() query: unknown, @Req() req: Request) {
    return this.service.searchItems(req.user!.tenantId, searchPriceableItemsQuerySchema.parse(query));
  }

  @Get('lookup')
  @RequirePermission('price_list', 'read')
  async lookup(@Query() query: unknown, @Req() req: Request) {
    return this.pricing.lookup(req.user!.tenantId, lookupPriceQuerySchema.parse(query));
  }

  /** Tính giá áp dụng hàng loạt — Tiếp nhận gọi cho Dịch vụ khám theo ngày tiếp nhận. POST chỉ vì có body, KHÔNG ghi gì. */
  @Post('resolve')
  @RequirePermission('price_list', 'read')
  @HttpCode(200)
  async resolve(@Body() body: unknown, @Req() req: Request) {
    return this.pricing.resolve(req.user!.tenantId, resolvePricesRequestSchema.parse(body));
  }

  @Get(':id')
  @RequirePermission('price_list', 'read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.getById(req.user!.tenantId, id);
  }

  /** "Xuất Excel" một bảng giá — cùng quyền đọc `price_list.read`. Nhị phân qua `@Res()` nên không đăng ký OpenAPI (web tải bằng `downloadFile()`). */
  @Get(':id/export')
  @RequirePermission('price_list', 'read')
  async exportExcel(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const { userId, tenantId } = req.user!;
    const detail = await this.service.getById(tenantId, id);
    const buffer = await this.exporter.build(detail);
    await this.service.recordExportAudit(tenantId, userId, id, extractRequestMeta(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${detail.code}.xlsx"`);
    res.send(buffer);
  }

  @Post()
  @RequirePermission('price_list', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createPriceListRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('price_list', 'update')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updatePriceListRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
