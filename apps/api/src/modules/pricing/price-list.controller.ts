import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
  createPriceListRequestSchema,
  itemsByGroupsRequestSchema,
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
import { PriceListImportService } from './price-list-import.service';
import { PriceListService } from './price-list.service';
import { PricingService } from './pricing.service';

/**
 * Bảng giá có thời hạn + tính giá áp dụng (Cận lâm sàng GĐ2, docs/DECISIONS.md #212). `price_list.read` mở cho mọi vai trò
 * cần tra giá (lễ tân lúc tiếp nhận, bác sĩ lúc chỉ định, "Tra thử giá"); tạo/sửa/ngừng chỉ clinic_admin.
 * Các route tĩnh (`items/search`, `lookup`, `resolve`) khai báo TRƯỚC `:id` — Express khớp theo thứ tự khai báo.
 */
const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('price-lists')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PriceListController {
  constructor(
    private readonly service: PriceListService,
    private readonly pricing: PricingService,
    private readonly exporter: PriceListExportService,
    private readonly importer: PriceListImportService,
  ) {}

  @Get()
  @RequirePermission('price_list', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    return this.service.list(req.user!.tenantId, listPriceListsQuerySchema.parse(query));
  }

  /** Các nhóm chọn được ở hộp thoại "Thêm theo nhóm" (dịch vụ kỹ thuật theo Nhóm dịch vụ, thuốc/vật tư theo Nhóm thuốc...) kèm số mặt hàng. */
  @Get('items/groups')
  @RequirePermission('price_list', 'read')
  async listGroups(@Req() req: Request) {
    return this.service.listGroups(req.user!.tenantId);
  }

  /** Mặt hàng thuộc các nhóm đã chọn (kèm giá mặc định) — POST chỉ vì có body, KHÔNG ghi gì. */
  @Post('items/by-groups')
  @RequirePermission('price_list', 'read')
  @HttpCode(200)
  async itemsByGroups(@Body() body: unknown, @Req() req: Request) {
    return this.service.itemsByGroups(req.user!.tenantId, itemsByGroupsRequestSchema.parse(body));
  }

  /** Tải file mẫu nhập Excel (sheet nhập có dòng ví dụ + Hướng dẫn + Danh mục hiện có) — trả thẳng binary, không qua envelope. */
  @Get('import-template')
  @RequirePermission('price_list', 'read')
  async downloadImportTemplate(@Req() req: Request, @Res() res: Response): Promise<void> {
    const buffer = await this.importer.buildTemplate(req.user!.tenantId);
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-bang-gia.xlsx"');
    res.send(buffer);
  }

  /** Đọc + đối chiếu file Excel, KHÔNG ghi gì — trả dòng hợp lệ và lỗi từng dòng; web gộp vào danh sách đang soạn. */
  @Post('import/preview')
  @RequirePermission('price_list', 'read')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  async previewImport(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Thiếu file Excel.');
    return this.importer.preview(req.user!.tenantId, file.buffer);
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
