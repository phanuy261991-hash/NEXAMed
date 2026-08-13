import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { z } from 'zod';
import {
  checkPatientDuplicateQuerySchema,
  createPatientRequestSchema,
  listPatientsQuerySchema,
  patientByPhoneQuerySchema,
  updatePatientRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { extractRequestMeta } from '../../common/request-meta';
import { MAX_PHOTO_SIZE_BYTES, PatientService } from './patient.service';

/** `version` đến từ multipart field dạng text (multer đặt vào `req.body` như mọi field không phải file). */
const uploadPatientPhotoFormSchema = z.object({ version: z.coerce.number().int().positive() });

@Controller('patients')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Post()
  @RequirePermission('patient', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createPatientRequestSchema.parse(body);
    // req.user luôn có giá trị ở đây — JwtAuthGuard đã throw UnauthorizedException trước đó nếu thiếu.
    const { userId, tenantId } = req.user!;
    return this.patientService.createPatient(tenantId, userId, dto, extractRequestMeta(req));
  }

  /**
   * Không gắn `@AuditView` — decorator này ghi 1 dòng audit cho ĐÚNG 1 entityId (đọc từ route
   * param), không khớp hình dạng "xem một danh sách nhiều bệnh nhân". Audit cho thao tác xem
   * danh sách (nếu cần) là việc khác, chưa có yêu cầu cụ thể ở PRD/security-audit.md.
   */
  @Get()
  @RequirePermission('patient', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listPatientsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.patientService.listPatients(tenantId, dto);
  }

  /**
   * PAT-03 — phải khai báo TRƯỚC `@Get(':id')`: NestJS/Express khớp route theo thứ tự khai báo,
   * nếu để sau thì `GET /patients/check-duplicate` sẽ bị `:id` nuốt mất (id = "check-duplicate").
   */
  @Get('check-duplicate')
  @RequirePermission('patient', 'read')
  async checkDuplicate(@Query() query: unknown, @Req() req: Request) {
    const dto = checkPatientDuplicateQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.patientService.checkDuplicates(tenantId, dto);
  }

  /**
   * Tra trùng SĐT (cảnh báo mềm form Thêm/Sửa khách hàng; chọn khách hàng ở trang Tiếp nhận) —
   * khai TRƯỚC `@Get(':id')`, cùng lý do `check-duplicate` ở trên. Tái dùng `patient.read`.
   */
  @Get('by-phone')
  @RequirePermission('patient', 'read')
  async findByPhone(@Query() query: unknown, @Req() req: Request) {
    const dto = patientByPhoneQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.patientService.findByPhone(tenantId, dto);
  }

  @Get(':id')
  @RequirePermission('patient', 'read', { entityIdParam: 'id' })
  @AuditView('patient')
  @UseInterceptors(AuditViewInterceptor)
  async getById(@Param('id') id: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.patientService.getPatient(tenantId, id);
  }

  @Patch(':id')
  @RequirePermission('patient', 'update', { entityIdParam: 'id' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updatePatientRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.patientService.updatePatient(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  /**
   * Upload/thay ảnh đại diện (docs/DECISIONS.md #034) — tái dùng quyền `patient.update` (đổi
   * ảnh cũng là sửa hồ sơ hành chính). Magic-byte/kích thước kiểm ở `PatientService.uploadPhoto`
   * (không tin `Content-Type` multer đọc từ header — .claude/docs/security-audit.md).
   */
  @Post(':id/photo')
  @RequirePermission('patient', 'update', { entityIdParam: 'id' })
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_SIZE_BYTES } }))
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Thiếu file ảnh.');
    }
    const { version } = uploadPatientPhotoFormSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.patientService.uploadPhoto(tenantId, userId, id, version, file.buffer, extractRequestMeta(req));
  }
}
