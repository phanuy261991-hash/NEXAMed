import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  createInsuranceCardRequestSchema,
  removeInsuranceCardQuerySchema,
  updateInsuranceCardRequestSchema,
  uploadInsuranceCardPhotoFormSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { MAX_INSURANCE_PHOTO_SIZE_BYTES, PatientInsuranceCardService } from './patient-insurance-card.service';

/**
 * Thẻ BHYT của bệnh nhân (S2-04, docs/DECISIONS.md #243). Quyền: xem = `patient.read`, thêm/sửa/xoá/ảnh = `patient.update` (không thêm quyền mới);
 * `entityIdParam: 'patientId'` để break-glass áp dụng đúng hồ sơ. Chủ dự án chốt số thẻ hiện rõ cho người có quyền xem bệnh nhân — KHÔNG gắn
 * `@AuditView` riêng (hồ sơ bệnh nhân đã có nhật ký xem chung). Công tắc "Áp dụng BHYT" tắt thì thêm/sửa/xoá trả 409 `INSURANCE_DISABLED`.
 */
@Controller('patients/:patientId/insurance-cards')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientInsuranceCardController {
  constructor(private readonly cardService: PatientInsuranceCardService) {}

  @Get()
  @RequirePermission('patient', 'read', { entityIdParam: 'patientId' })
  async list(@Param('patientId') patientId: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.cardService.listForPatient(tenantId, patientId);
  }

  @Post()
  @RequirePermission('patient', 'update', { entityIdParam: 'patientId' })
  @HttpCode(200)
  async create(@Param('patientId') patientId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = createInsuranceCardRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cardService.createCard(tenantId, userId, patientId, dto, extractRequestMeta(req));
  }

  @Patch(':cardId')
  @RequirePermission('patient', 'update', { entityIdParam: 'patientId' })
  async update(@Param('patientId') patientId: string, @Param('cardId') cardId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateInsuranceCardRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cardService.updateCard(tenantId, userId, patientId, cardId, dto, extractRequestMeta(req));
  }

  @Delete(':cardId')
  @RequirePermission('patient', 'update', { entityIdParam: 'patientId' })
  async remove(@Param('patientId') patientId: string, @Param('cardId') cardId: string, @Query() query: unknown, @Req() req: Request) {
    const { version } = removeInsuranceCardQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    await this.cardService.removeCard(tenantId, userId, patientId, cardId, version, extractRequestMeta(req));
    return { removed: true };
  }

  /** Ảnh thẻ (mặt trước/sau) — magic-byte/kích thước kiểm ở service (không tin `Content-Type` multer đọc từ header). */
  @Post(':cardId/photo')
  @RequirePermission('patient', 'update', { entityIdParam: 'patientId' })
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_INSURANCE_PHOTO_SIZE_BYTES } }))
  async uploadPhoto(
    @Param('patientId') patientId: string,
    @Param('cardId') cardId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Thiếu file ảnh.');
    }
    const { side, version } = uploadInsuranceCardPhotoFormSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cardService.uploadPhoto(tenantId, userId, patientId, cardId, side, version, file.buffer, extractRequestMeta(req));
  }
}
