import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { PARACLINICAL_GROUP_KINDS, PARACLINICAL_GROUP_PERMISSION_MODULE } from '@nexamed/core';
import { PARACLINICAL_IMAGE_MAX_BYTES, amendParaclinicalResultRequestSchema, listParaclinicalQueueQuerySchema, saveParaclinicalResultRequestSchema, startParaclinicalItemsRequestSchema } from '@nexamed/shared';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ParaclinicalResultService, type ResultAccessScope } from './paraclinical-result.service';

const scopeOf = (req: Request): ResultAccessScope => ({ dataScope: req.dataScope!, kinds: PARACLINICAL_GROUP_KINDS.imaging, permissionModule: PARACLINICAL_GROUP_PERMISSION_MODULE.imaging });

/**
 * Menu "Chẩn đoán hình ảnh & Thăm dò chức năng" — hàng đợi, gọi vào phòng, nhập mô tả + kết luận, ảnh đính kèm, duyệt kết quả (docs/DECISIONS.md #212; tách 2 menu #215).
 * Quyền `imaging_result.*`, chỉ phục vụ dịch vụ loại IMAGING/FUNCTIONAL. Cùng service với `LabResultController`; khác nhau ở quyền, nhóm dịch vụ và có thêm ảnh đính kèm.
 */
@Controller('paraclinical/imaging')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ImagingResultController {
  constructor(private readonly service: ParaclinicalResultService) {}

  @Get('queue')
  @RequirePermission('imaging_result', 'read')
  async queue(@Query() query: unknown, @Req() req: Request) {
    return this.service.listQueue(req.user!.tenantId, req.user!.userId, scopeOf(req), listParaclinicalQueueQuerySchema.parse(query));
  }

  /** "Gọi vào phòng" — dịch vụ chuyển sang "Đang trong phòng". */
  @Post('start')
  @RequirePermission('imaging_result', 'enter')
  @HttpCode(200)
  async start(@Body() body: unknown, @Req() req: Request) {
    const dto = startParaclinicalItemsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.startItems(tenantId, userId, scopeOf(req), dto, extractRequestMeta(req));
  }

  @Get('items/:itemId/result')
  @RequirePermission('imaging_result', 'read')
  @AuditView('paraclinical_result', { paramName: 'itemId' })
  @UseInterceptors(AuditViewInterceptor)
  async getResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return { form: await this.service.getForm(tenantId, userId, scopeOf(req), itemId) };
  }

  @Put('items/:itemId/result')
  @RequirePermission('imaging_result', 'enter')
  async saveResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveParaclinicalResultRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { form: await this.service.save(tenantId, userId, scopeOf(req), itemId, dto, extractRequestMeta(req)) };
  }

  @Post('items/:itemId/result/print')
  @RequirePermission('imaging_result', 'read')
  @HttpCode(200)
  async printResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    await this.service.recordPrint(tenantId, userId, scopeOf(req), itemId, extractRequestMeta(req));
    return { ok: true };
  }

  /** Thêm ảnh đính kèm (siêu âm, X-quang...) — multipart `file`; kiểm magic-byte/dung lượng ở service (không tin Content-Type). */
  @Post('items/:itemId/images')
  @RequirePermission('imaging_result', 'enter')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PARACLINICAL_IMAGE_MAX_BYTES } }))
  async addImage(@Param('itemId', ParseUUIDPipe) itemId: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Thiếu file ảnh.');
    const { userId, tenantId } = req.user!;
    return { form: await this.service.addImage(tenantId, userId, scopeOf(req), itemId, { buffer: file.buffer, originalname: file.originalname }, extractRequestMeta(req)) };
  }

  @Delete('images/:imageId')
  @RequirePermission('imaging_result', 'enter')
  async removeImage(@Param('imageId', ParseUUIDPipe) imageId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return { form: await this.service.removeImage(tenantId, userId, scopeOf(req), imageId, extractRequestMeta(req)) };
  }

  /** "Đính chính" kết quả đã duyệt: đề nghị kèm lý do (quyền Nhập của nhóm), bác sĩ có quyền Duyệt ký lại. */
  @Post('items/:itemId/result/amend')
  @RequirePermission('imaging_result', 'enter')
  @HttpCode(200)
  async amendResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = amendParaclinicalResultRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { form: await this.service.startAmendment(tenantId, userId, scopeOf(req), itemId, dto, extractRequestMeta(req)) };
  }

  /** Huỷ đính chính đang soạn/chờ duyệt — khôi phục bản đã duyệt cũ. */
  @Post('items/:itemId/result/amend/cancel')
  @RequirePermission('imaging_result', 'enter')
  @HttpCode(200)
  async cancelAmendment(@Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return { form: await this.service.cancelAmendment(tenantId, userId, scopeOf(req), itemId, extractRequestMeta(req)) };
  }

  @Post('items/:itemId/result/approve')
  @RequirePermission('imaging_result', 'approve')
  @HttpCode(200)
  async approveResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveParaclinicalResultRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { form: await this.service.approve(tenantId, userId, scopeOf(req), itemId, dto, extractRequestMeta(req)) };
  }
}
