import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { closePendingRequestSchema, setDoctorAvailabilityRequestSchema, shiftSummaryQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { requireBranchId } from '../../common/branch-context';
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

  /** Thanh đỉnh của bác sĩ: các ngày trước chưa đóng ca (chặn khám) + giờ nhắc đóng ca hôm nay theo ca đã xếp.
   * Tính cho CHÍNH người gọi, không nhận id nào từ client. */
  @Get('me/closing-state')
  @RequirePermission('doctor_availability', 'update')
  async getMyClosingState(@Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.doctorAvailabilityService.getMyClosingState(tenantId, requireBranchId(req.user!), userId);
  }

  /** Dải nhắc của lễ tân/quản trị: bác sĩ nào còn ngày chưa đóng ca (để "Đóng ca hộ"). */
  @Get('pending-closures')
  @RequirePermission('doctor_availability', 'update')
  async getPendingClosuresBoard(@Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.doctorAvailabilityService.getPendingClosuresBoard(tenantId, requireBranchId(req.user!), userId);
  }

  @Put(':doctorId')
  @RequirePermission('doctor_availability', 'update')
  async setStatus(@Param('doctorId') doctorId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = setDoctorAvailabilityRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.doctorAvailabilityService.setStatus(tenantId, requireBranchId(req.user!), userId, req.dataScope!, doctorId, dto, extractRequestMeta(req));
  }

  /** Popup xác nhận "Đóng ca hôm nay" — cùng quyền `doctor_availability.update` (chỉ là bước xem
   * trước khi thao tác đóng ca thật, không cần permission đọc riêng). */
  @Get(':doctorId/shift-summary')
  @RequirePermission('doctor_availability', 'update')
  async getShiftSummary(@Param('doctorId') doctorId: string, @Query() query: unknown, @Req() req: Request) {
    const { date } = shiftSummaryQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.doctorAvailabilityService.getShiftSummary(tenantId, requireBranchId(req.user!), userId, req.dataScope!, doctorId, date);
  }

  /** "Đóng ca ngày trước" — đóng tất cả ngày chưa đóng của bác sĩ (máy chủ tự tính lại danh sách ngày). */
  @Post(':doctorId/close-pending')
  @HttpCode(200)
  @RequirePermission('doctor_availability', 'update')
  async closePending(@Param('doctorId') doctorId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = closePendingRequestSchema.parse(body ?? {});
    const { userId, tenantId } = req.user!;
    return this.doctorAvailabilityService.closePending(tenantId, requireBranchId(req.user!), userId, req.dataScope!, doctorId, dto, extractRequestMeta(req));
  }
}
