import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
  bulkCreateWorkShiftAssignmentRequestSchema,
  copyWorkShiftAssignmentsRequestSchema,
  createWorkShiftAssignmentRequestSchema,
  deleteWorkShiftAssignmentRequestSchema,
  listWorkShiftAssignmentsQuerySchema,
  workShiftAssignmentMonthSchema,
} from '@nexamed/shared';
import { z } from 'zod';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { WorkShiftAssignmentService } from './work-shift-assignment.service';
import { WorkShiftAssignmentImportService } from './work-shift-assignment-import.service';

const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const monthQuerySchema = z.object({ month: workShiftAssignmentMonthSchema });
const importFormBodySchema = z.object({ month: workShiftAssignmentMonthSchema });

/** Chặn Nhập/Xuất Excel ngoài "Lịch làm việc nhân viên" — đúng phạm vi đã chốt (chỉ scope
 * `global`, tức chỉ `clinic_admin` mặc định). `RequirePermission` không phân biệt được scope
 * personal/global (không có khái niệm "chỉ global" trong guard), nên kiểm tay ở đây. */
function assertGlobalScope(req: Request): void {
  if (req.dataScope !== 'global') {
    throw new ForbiddenException('Chỉ áp dụng cho tài khoản quản lý toàn bộ lịch làm việc nhân viên.');
  }
}

/** "Đăng ký ca làm việc" — xem docstring `WorkShiftAssignmentService`. */
@Controller('work-shift-assignments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WorkShiftAssignmentController {
  constructor(
    private readonly service: WorkShiftAssignmentService,
    private readonly importService: WorkShiftAssignmentImportService,
  ) {}

  @Get()
  @RequirePermission('work_shift_assignment', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listWorkShiftAssignmentsQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.service.list(tenantId, userId, req.dataScope!, dto);
  }

  @Post()
  @RequirePermission('work_shift_assignment', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createWorkShiftAssignmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  /** "Áp dụng cho các ngày đã chọn" (bulk-apply nhiều ngày cùng 1 ca) — khai TRƯỚC route gốc không
   * cần thiết (khác `@Post()` không tham số, không xung đột thứ tự route). */
  @Post('bulk')
  @RequirePermission('work_shift_assignment', 'create')
  @HttpCode(200)
  async bulkCreate(@Body() body: unknown, @Req() req: Request) {
    const dto = bulkCreateWorkShiftAssignmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.bulkCreate(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  /** "Sao chép tuần/tháng trước". */
  @Post('copy')
  @RequirePermission('work_shift_assignment', 'create')
  @HttpCode(200)
  async copy(@Body() body: unknown, @Req() req: Request) {
    const dto = copyWorkShiftAssignmentsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.copy(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  /** Tải file mẫu Excel đúng tháng đã chọn (chỉ "Lịch làm việc nhân viên") — trả thẳng binary,
   * không qua envelope `{data,meta}` (đúng khuôn `PublicFileController`). */
  @Get('import-template')
  @RequirePermission('work_shift_assignment', 'create')
  async downloadImportTemplate(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    assertGlobalScope(req);
    const dto = monthQuerySchema.parse(query);
    const buffer = await this.importService.buildTemplate(dto.month);
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="mau-lich-lam-viec-${dto.month}.xlsx"`);
    res.send(buffer);
  }

  /** Xuất Excel đúng tháng đang xem trên "Lịch làm việc nhân viên". */
  @Get('export')
  @RequirePermission('work_shift_assignment', 'read')
  async exportExcel(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    assertGlobalScope(req);
    const dto = monthQuerySchema.parse(query);
    const { tenantId } = req.user!;
    const buffer = await this.importService.buildExport(tenantId, dto.month);
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="lich-lam-viec-${dto.month}.xlsx"`);
    res.send(buffer);
  }

  /** Đọc + đối chiếu file theo ĐÚNG tháng đã chọn, KHÔNG ghi gì — người dùng tự xem 3 nhóm (hợp
   * lệ/trùng/lỗi) rồi mới bấm "Xác nhận nhập" (gọi `commit` với cùng file + tháng). */
  @Post('import/preview')
  @RequirePermission('work_shift_assignment', 'create')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  async previewImport(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown, @Req() req: Request) {
    assertGlobalScope(req);
    if (!file) throw new BadRequestException('Thiếu file Excel.');
    const { month } = importFormBodySchema.parse(body);
    const { tenantId } = req.user!;
    return this.importService.preview(tenantId, month, file.buffer);
  }

  /** Đọc lại ĐÚNG file + tháng đã preview rồi ghi các ô hợp lệ — ô trùng/lỗi luôn bị bỏ qua. */
  @Post('import/commit')
  @RequirePermission('work_shift_assignment', 'create')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES } }))
  async commitImport(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown, @Req() req: Request) {
    assertGlobalScope(req);
    if (!file) throw new BadRequestException('Thiếu file Excel.');
    const { month } = importFormBodySchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.importService.commit(tenantId, userId, month, file.buffer);
  }

  @Delete(':id')
  @RequirePermission('work_shift_assignment', 'delete', { entityIdParam: 'id' })
  async remove(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = deleteWorkShiftAssignmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    await this.service.remove(tenantId, userId, req.dataScope!, id, dto.version, extractRequestMeta(req));
    return { success: true };
  }
}
