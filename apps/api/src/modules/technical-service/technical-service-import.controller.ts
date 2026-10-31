import { BadRequestException, Controller, Get, HttpCode, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { TechnicalServiceImportService } from './technical-service-import.service';

const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Nhập/Xuất Excel "Dịch vụ kỹ thuật" (docs/DECISIONS.md #276). Khai báo TRƯỚC `TechnicalServiceController` trong `TechnicalServiceModule.controllers` — `GET
 * technical-services/export` và `GET technical-services/import-template` phải khớp trước `GET technical-services/:id`, nếu không bị coi là `id`. Nhập cần
 * `technical_service.create`; xuất cần `technical_service.read` (và ghi audit). Danh mục dùng chung của công ty (không theo chi nhánh).
 */
@Controller('technical-services')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class TechnicalServiceImportController {
  constructor(private readonly importService: TechnicalServiceImportService) {}

  /** Tải file mẫu (sheet nhập có dữ liệu ví dụ + hướng dẫn + danh mục hiện có) — trả thẳng binary, không qua envelope. */
  @Get('import-template')
  @RequirePermission('technical_service', 'create')
  async downloadTemplate(@Req() req: Request, @Res() res: Response): Promise<void> {
    const buffer = await this.importService.buildTemplate(req.user!.tenantId);
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-dich-vu-ky-thuat.xlsx"');
    res.send(buffer);
  }

  /** Xuất toàn bộ dịch vụ kỹ thuật (cả đã ẩn) — cùng định dạng file mẫu nên nhập lại được. */
  @Get('export')
  @RequirePermission('technical_service', 'read')
  async exportExcel(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { userId, tenantId } = req.user!;
    const buffer = await this.importService.buildExport(tenantId, userId, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="danh-muc-dich-vu-ky-thuat.xlsx"');
    res.send(buffer);
  }

  /** Đọc + đối chiếu file, KHÔNG ghi gì — trả các nhóm (hợp lệ/đã có sẵn/lỗi từng dòng/danh mục sẽ tạo mới) để người dùng xem trước và sửa file. */
  @Post('import/preview')
  @RequirePermission('technical_service', 'create')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  async previewImport(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Thiếu file Excel.');
    const { userId, tenantId } = req.user!;
    return this.importService.preview(tenantId, userId, file.buffer);
  }

  /** Đọc lại ĐÚNG file đã xem trước rồi ghi tất cả dịch vụ hợp lệ trong MỘT transaction; trùng/lỗi luôn bị bỏ qua. */
  @Post('import/commit')
  @RequirePermission('technical_service', 'create')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  async commitImport(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Thiếu file Excel.');
    const { userId, tenantId } = req.user!;
    return this.importService.commit(tenantId, userId, file.buffer, extractRequestMeta(req));
  }
}
