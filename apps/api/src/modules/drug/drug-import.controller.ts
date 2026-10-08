import { BadRequestException, Controller, Get, HttpCode, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { DrugImportService } from './drug-import.service';

const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Nhập/Xuất Excel "Thuốc & Vật tư y tế" (docs/DECISIONS.md #210). Khai báo TRƯỚC `DrugController` trong
 * `DrugModule.controllers` — `GET drugs/export` và `GET drugs/import-template` phải khớp trước
 * `GET drugs/:id`, nếu không bị coi là `id`. Nhập cần `drug.create`; xuất cần `drug.read` (và ghi audit).
 */
@Controller('drugs')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DrugImportController {
  constructor(private readonly importService: DrugImportService) {}

  /** Tải file mẫu (3 sheet nhập có dữ liệu ví dụ + hướng dẫn + danh mục hiện có) — trả thẳng binary, không qua envelope. */
  @Get('import-template')
  @RequirePermission('drug', 'create')
  async downloadTemplate(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { tenantId } = req.user!;
    const buffer = await this.importService.buildTemplate(tenantId);
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-thuoc-vat-tu.xlsx"');
    res.send(buffer);
  }

  /** Xuất toàn bộ danh mục Thuốc & Vật tư (cả mặt hàng đã ẩn) — cùng định dạng file mẫu nên nhập lại được. */
  @Get('export')
  @RequirePermission('drug', 'read')
  async exportExcel(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { userId, tenantId } = req.user!;
    const buffer = await this.importService.buildExport(tenantId, userId, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="danh-muc-thuoc-vat-tu.xlsx"');
    res.send(buffer);
  }

  /** Đọc + đối chiếu file, KHÔNG ghi gì — trả các nhóm (hợp lệ/đã có sẵn/lỗi/danh mục sẽ tạo mới) để người dùng xem trước. */
  @Post('import/preview')
  @RequirePermission('drug', 'create')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  async previewImport(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Thiếu file Excel.');
    const { userId, tenantId } = req.user!;
    return this.importService.preview(tenantId, userId, file.buffer);
  }

  /** Đọc lại ĐÚNG file đã xem trước rồi ghi tất cả mặt hàng hợp lệ trong MỘT transaction; trùng/lỗi luôn bị bỏ qua. */
  @Post('import/commit')
  @RequirePermission('drug', 'create')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  async commitImport(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Thiếu file Excel.');
    const { userId, tenantId } = req.user!;
    return this.importService.commit(tenantId, userId, file.buffer, extractRequestMeta(req));
  }
}
