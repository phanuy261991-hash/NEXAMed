import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { setDoctorAvailabilityRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { DoctorAvailabilityService } from './doctor-availability.service';

/** "Tạm nghỉ / Đóng ca" của bác sĩ — xem docstring `DoctorAvailabilityService`. */
@Controller('doctor-availability')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DoctorAvailabilityController {
  constructor(private readonly doctorAvailabilityService: DoctorAvailabilityService) {}

  /** Board điều phối lễ tân — tái dùng `encounter.read` (đã cấp `global` cho receptionist/nurse/
   * doctor/clinic_admin), không thêm permission đọc riêng. */
  @Get('today')
  @RequirePermission('encounter', 'read')
  async getTodayBoard(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.doctorAvailabilityService.getTodayBoard(tenantId);
  }

  /** Chiếu tối thiểu TỰ-PHỤC VỤ — không `@RequirePermission` (đúng khuôn `GET /clinic-settings/
   * deferred-payment-enabled`, #030), mọi user đã đăng nhập đọc được 2 công tắc để quyết định
   * hiện/ẩn nút ở UI của chính họ. Khai TRƯỚC `@Put(':doctorId')` không cần thiết (khác path tĩnh). */
  @Get('policy')
  async getPolicy(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.doctorAvailabilityService.getPolicy(tenantId);
  }

  @Put(':doctorId')
  @RequirePermission('doctor_availability', 'update')
  async setStatus(@Param('doctorId') doctorId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = setDoctorAvailabilityRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.doctorAvailabilityService.setStatus(tenantId, userId, req.dataScope!, doctorId, dto, extractRequestMeta(req));
  }

  /** Popup xác nhận "Đóng ca hôm nay" — cùng quyền `doctor_availability.update` (chỉ là bước xem
   * trước khi thao tác đóng ca thật, không cần permission đọc riêng). */
  @Get(':doctorId/shift-summary')
  @RequirePermission('doctor_availability', 'update')
  async getShiftSummary(@Param('doctorId') doctorId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.doctorAvailabilityService.getShiftSummary(tenantId, userId, req.dataScope!, doctorId);
  }
}
