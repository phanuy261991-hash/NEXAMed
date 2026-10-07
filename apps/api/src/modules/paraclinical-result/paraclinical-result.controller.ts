import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { PARACLINICAL_IMAGE_MAX_BYTES, listParaclinicalQueueQuerySchema, saveParaclinicalResultRequestSchema, startParaclinicalItemsRequestSchema } from '@nexamed/shared';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ParaclinicalResultService } from './paraclinical-result.service';

/**
 * Hàng đợi + thực hiện + nhập/duyệt kết quả cận lâm sàng (Cận lâm sàng GĐ4 đợt 1, docs/DECISIONS.md #212). Quyền TÁCH HAI: `enter` (lấy mẫu/gọi vào phòng, lưu nháp, gửi duyệt —
 * kỹ thuật viên, điều dưỡng, bác sĩ) và `approve` (duyệt & trả kết quả = ký — bác sĩ/clinic_admin) để kỹ thuật viên không tự ký kết quả.
 * Không có data_scope theo chủ sở hữu: kết quả thuộc phòng khám, ai có quyền đều làm việc trên toàn bộ hàng đợi.
 */
@Controller('paraclinical')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ParaclinicalResultController {
  constructor(private readonly service: ParaclinicalResultService) {}

  @Get('queue')
  @RequirePermission('paraclinical_result', 'read')
  async queue(@Query() query: unknown, @Req() req: Request) {
    return this.service.listQueue(req.user!.tenantId, req.user!.userId, req.dataScope!, listParaclinicalQueueQuerySchema.parse(query));
  }

  /** "Lấy mẫu" / "Gọi vào phòng" — các dòng cùng phiếu chuyển sang "Đang thực hiện". */
  @Post('start')
  @RequirePermission('paraclinical_result', 'enter')
  @HttpCode(200)
  async start(@Body() body: unknown, @Req() req: Request) {
    const dto = startParaclinicalItemsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.startItems(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  // Kết quả cận lâm sàng là dữ liệu lâm sàng → ghi audit "xem" (security-audit.md). entityId = id dòng chỉ định mở màn.
  @Get('items/:itemId/result')
  @RequirePermission('paraclinical_result', 'read')
  @AuditView('paraclinical_result', { paramName: 'itemId' })
  @UseInterceptors(AuditViewInterceptor)
  async getResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return { form: await this.service.getForm(tenantId, userId, req.dataScope!, itemId) };
  }

  @Put('items/:itemId/result')
  @RequirePermission('paraclinical_result', 'enter')
  async saveResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveParaclinicalResultRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { form: await this.service.save(tenantId, userId, req.dataScope!, itemId, dto, extractRequestMeta(req)) };
  }

  /** Ghi audit in phiếu kết quả (web tự dựng bản in từ dữ liệu đã tải). */
  @Post('items/:itemId/result/print')
  @RequirePermission('paraclinical_result', 'read')
  @HttpCode(200)
  async printResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    await this.service.recordPrint(tenantId, userId, req.dataScope!, itemId, extractRequestMeta(req));
    return { ok: true };
  }

  /** Thêm ảnh đính kèm (siêu âm, X-quang...) — multipart `file`; kiểm magic-byte/dung lượng ở service (không tin Content-Type). */
  @Post('items/:itemId/images')
  @RequirePermission('paraclinical_result', 'enter')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PARACLINICAL_IMAGE_MAX_BYTES } }))
  async addImage(@Param('itemId', ParseUUIDPipe) itemId: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Thiếu file ảnh.');
    const { userId, tenantId } = req.user!;
    return { form: await this.service.addImage(tenantId, userId, req.dataScope!, itemId, { buffer: file.buffer, originalname: file.originalname }, extractRequestMeta(req)) };
  }

  @Delete('images/:imageId')
  @RequirePermission('paraclinical_result', 'enter')
  async removeImage(@Param('imageId', ParseUUIDPipe) imageId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return { form: await this.service.removeImage(tenantId, userId, req.dataScope!, imageId, extractRequestMeta(req)) };
  }

  @Post('items/:itemId/result/approve')
  @RequirePermission('paraclinical_result', 'approve')
  @HttpCode(200)
  async approveResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveParaclinicalResultRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { form: await this.service.approve(tenantId, userId, req.dataScope!, itemId, dto, extractRequestMeta(req)) };
  }
}
