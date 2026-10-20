import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { saveInteropCredentialRequestSchema, updatePrescriptionInteropSettingsRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { requireBranchId } from '../../common/branch-context';
import { PrescriptionInteropService } from './prescription-interop.service';

/**
 * Liên thông đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3). Xem trang cần `clinic_config.read`; lưu cấu hình/mã/mật khẩu cần `clinic_config.update` (không thêm quyền mới).
 * `GET status` tự-phục vụ (không `@RequirePermission`, đúng khuôn các công tắc `clinic-settings/*-enabled`): bác sĩ/điều dưỡng cần biết có hiện phần liên thông không.
 */
@Controller('prescription-interop')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PrescriptionInteropController {
  constructor(private readonly service: PrescriptionInteropService) {}

  @Get('status')
  async status(@Req() req: Request) {
    return this.service.getStatus(req.user!.tenantId);
  }

  @Get('settings')
  @RequirePermission('clinic_config', 'read')
  async getSettings(@Req() req: Request) {
    return this.service.getSettings(req.user!.tenantId);
  }

  @Patch('settings')
  @RequirePermission('clinic_config', 'update')
  async updateSettings(@Body() body: unknown, @Req() req: Request) {
    const dto = updatePrescriptionInteropSettingsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.updateSettings(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Get('facilities')
  @RequirePermission('clinic_config', 'read')
  async listFacilities(@Req() req: Request) {
    return this.service.listFacilities(req.user!.tenantId);
  }

  @Put('facilities/:branchId/credential')
  @RequirePermission('clinic_config', 'update')
  async saveFacilityCredential(@Param('branchId', ParseUUIDPipe) branchId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveInteropCredentialRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.saveFacilityCredential(tenantId, userId, branchId, dto, extractRequestMeta(req));
  }

  /** "Kiểm tra kết nối" / "Đăng nhập lại": đăng nhập cơ sở thật bằng mã + mật khẩu đã lưu, lưu token mới. Trả 200 kể cả khi cổng từ chối (kết quả nằm trong `outcome`). */
  @Post('facilities/:branchId/login')
  @HttpCode(200)
  @RequirePermission('clinic_config', 'update')
  async loginFacility(@Param('branchId', ParseUUIDPipe) branchId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.loginFacility(tenantId, userId, branchId, extractRequestMeta(req));
  }

  @Get('doctors')
  @RequirePermission('clinic_config', 'read')
  async listDoctors(@Req() req: Request) {
    return this.service.listDoctors(req.user!.tenantId, requireBranchId(req.user!));
  }

  @Put('doctors/:userId/credential')
  @RequirePermission('clinic_config', 'update')
  async saveDoctorCredential(@Param('userId', ParseUUIDPipe) targetUserId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveInteropCredentialRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.saveDoctorCredential(tenantId, userId, requireBranchId(req.user!), targetUserId, dto, extractRequestMeta(req));
  }

  /** "Thêm vào cơ sở" (API IV): thêm bác sĩ vào cơ sở của chi nhánh đang làm việc trên cổng. */
  @Post('doctors/:userId/add-to-facility')
  @HttpCode(200)
  @RequirePermission('clinic_config', 'update')
  async addDoctorToFacility(@Param('userId', ParseUUIDPipe) targetUserId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.addDoctorToFacility(tenantId, userId, requireBranchId(req.user!), targetUserId, extractRequestMeta(req));
  }

  /** "Xoá khỏi cơ sở" (API V). */
  @Post('doctors/:userId/remove-from-facility')
  @HttpCode(200)
  @RequirePermission('clinic_config', 'update')
  async removeDoctorFromFacility(@Param('userId', ParseUUIDPipe) targetUserId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.removeDoctorFromFacility(tenantId, userId, requireBranchId(req.user!), targetUserId, extractRequestMeta(req));
  }
}
