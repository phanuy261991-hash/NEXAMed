import { BadRequestException, Controller, Get, HttpCode, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { LabPartnerPriceImportService } from './lab-partner-price-import.service';

const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Nhập/Xuất Excel "Giá trả đối tác" (docs/DECISIONS.md #291 GĐ4). Mọi route cần quyền sửa dịch vụ kỹ thuật (`technical_service.update`, cùng quyền với việc sửa giá trả ở form dịch vụ — chủ dự án chốt
 * 10/11/2026); công tắc "Dùng đối tác xét nghiệm" tắt thì 409. Khai báo route cố định `lab-partners/price-import/...` riêng, không đụng `GET lab-partners/summary`.
 */
@Controller('lab-partners/price-import')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LabPartnerPriceImportController {
  constructor(private readonly service: LabPartnerPriceImportService) {}

  /** File mẫu: có sẵn dịch vụ gửi đối tác + cột từng đối tác đang dùng + một dòng ví dụ + hướng dẫn + danh mục hiện có. */
  @Get('template')
  @RequirePermission('technical_service', 'update')
  async template(@Req() req: Request, @Res() res: Response): Promise<void> {
    const buffer = await this.service.buildTemplate(req.user!.tenantId);
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="mau-gia-tra-doi-tac.xlsx"');
    res.send(buffer);
  }

  /** Xuất giá trả hiện có (cùng định dạng file mẫu, không dòng ví dụ) — sửa rồi nhập lại được. Ghi nhật ký kiểm toán. */
  @Get('export')
  @RequirePermission('technical_service', 'update')
  async exportExcel(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { userId, tenantId } = req.user!;
    const buffer = await this.service.buildExport(tenantId, userId, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="gia-tra-doi-tac.xlsx"');
    res.send(buffer);
  }

  /** Đọc + đối chiếu file, KHÔNG ghi gì — trả các ô giá sẽ đổi/thêm/giữ và lỗi từng dòng. */
  @Post('preview')
  @RequirePermission('technical_service', 'update')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  async preview(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Thiếu file Excel.');
    return this.service.preview(req.user!.tenantId, file.buffer);
  }

  /** Đọc lại ĐÚNG file đã xem trước rồi ghi trong MỘT transaction; còn lỗi thì 422 và không ghi gì. */
  @Post('commit')
  @RequirePermission('technical_service', 'update')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  async commit(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Thiếu file Excel.');
    const { userId, tenantId } = req.user!;
    return this.service.commit(tenantId, userId, file.buffer, extractRequestMeta(req));
  }
}
