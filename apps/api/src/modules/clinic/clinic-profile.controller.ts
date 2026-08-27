import { BadRequestException, Body, Controller, Get, HttpCode, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { z } from 'zod';
import { updateClinicProfileRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ClinicProfileService, MAX_LOGO_SIZE_BYTES } from './clinic-profile.service';

/** `version` đến từ multipart field dạng text — cùng mẫu `uploadPatientPhotoFormSchema`. */
const uploadLogoFormSchema = z.object({ version: z.coerce.number().int().positive() });

/**
 * Trang "Thông tin phòng khám" (2026-08-13) — dùng lại quyền `clinic_config.read`/`.update` sẵn
 * có (cùng `ClinicSettingsController`), không thêm permission mới.
 */
@Controller('clinic-profile')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ClinicProfileController {
  constructor(private readonly clinicProfileService: ClinicProfileService) {}

  @Get()
  @RequirePermission('clinic_config', 'read')
  async get(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.clinicProfileService.getProfile(tenantId);
  }

  /**
   * Tự-phục vụ (Thu ngân cơ bản/Kê đơn) — KHÔNG gắn `@RequirePermission`, đúng khuôn
   * `GET /clinic-settings/deferred-payment-enabled`/`GET /appointments/doctors` (#030): lễ tân/bác
   * sĩ cần tên/logo phòng khám để in phiếu thu/đơn thuốc nhưng không có `clinic_config.read`.
   */
  @Get('print-header')
  async getPrintHeader(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.clinicProfileService.getPrintHeader(tenantId);
  }

  @Patch()
  @RequirePermission('clinic_config', 'update')
  async update(@Body() body: unknown, @Req() req: Request) {
    const dto = updateClinicProfileRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.clinicProfileService.updateProfile(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Post('logo')
  @RequirePermission('clinic_config', 'update')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_SIZE_BYTES } }))
  async uploadLogo(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('Thiếu file ảnh.');
    }
    const { version } = uploadLogoFormSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.clinicProfileService.uploadLogo(tenantId, userId, version, file.buffer, extractRequestMeta(req));
  }

  @Post('print-logo')
  @RequirePermission('clinic_config', 'update')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_SIZE_BYTES } }))
  async uploadPrintLogo(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('Thiếu file ảnh.');
    }
    const { version } = uploadLogoFormSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.clinicProfileService.uploadPrintLogo(tenantId, userId, version, file.buffer, extractRequestMeta(req));
  }
}
