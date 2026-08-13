import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  appointmentPhoneLookupQuerySchema,
  cancelAppointmentRequestSchema,
  createAppointmentRequestSchema,
  listAppointmentsQuerySchema,
  rescheduleAppointmentRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { AppointmentService } from './appointment.service';

@Controller('appointments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Post()
  @RequirePermission('appointment', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createAppointmentRequestSchema.parse(body);
    // req.user/req.dataScope luôn có giá trị ở đây — JwtAuthGuard/PermissionGuard đã chạy trước.
    const { userId, tenantId } = req.user!;
    return this.appointmentService.createAppointment(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  @Get()
  @RequirePermission('appointment', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listAppointmentsQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.appointmentService.listAppointments(tenantId, userId, req.dataScope!, dto);
  }

  /**
   * Chiếu tối thiểu danh sách bác sĩ + cấu hình lịch cho màn hình Lịch hẹn (S2-09) — gắn quyền
   * `appointment.read` (lễ tân/bác sĩ đã có sẵn) thay vì `user_account.read`/`clinic_config.read`
   * (chỉ admin) — xem docs/DECISIONS.md. Khai báo TRƯỚC `@Get(':id')` — bắt buộc vì NestJS/Express
   * khớp route theo thứ tự khai báo, cùng lý do `check-duplicate` ở patient module.
   */
  @Get('doctors')
  @RequirePermission('appointment', 'read')
  async listDoctors(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.appointmentService.listDoctors(tenantId);
  }

  @Get('schedule-config')
  @RequirePermission('appointment', 'read')
  async getScheduleConfig(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.appointmentService.getScheduleConfig(tenantId);
  }

  /**
   * Tra cứu theo SĐT lúc đặt lịch (docs/DECISIONS.md #032) — tự điền tên + cảnh báo spam phía
   * web. Khai báo trước `@Get(':id')` cùng lý do `doctors`/`schedule-config` ở trên.
   */
  @Get('lookup')
  @RequirePermission('appointment', 'read')
  async lookupByPhone(@Query() query: unknown, @Req() req: Request) {
    const dto = appointmentPhoneLookupQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.appointmentService.lookupByPhone(tenantId, dto.phone);
  }

  @Get(':id')
  @RequirePermission('appointment', 'read', { entityIdParam: 'id' })
  async getById(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.appointmentService.getAppointment(tenantId, userId, req.dataScope!, id);
  }

  @Post(':id/cancel')
  @RequirePermission('appointment', 'cancel', { entityIdParam: 'id' })
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = cancelAppointmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.appointmentService.cancelAppointment(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Patch(':id/reschedule')
  @RequirePermission('appointment', 'update', { entityIdParam: 'id' })
  async reschedule(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rescheduleAppointmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.appointmentService.rescheduleAppointment(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }
}
