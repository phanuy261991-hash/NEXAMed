import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  PATIENT_DOCUMENT_MAX_BYTES,
  createPatientDocumentFolderRequestSchema,
  listPatientDocumentsQuerySchema,
  removePatientDocumentFolderQuerySchema,
  removePatientDocumentQuerySchema,
  renamePatientDocumentFolderRequestSchema,
  updatePatientDocumentRequestSchema,
  uploadPatientDocumentFormSchema,
} from '@nexamed/shared';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { PatientDocumentService } from './patient-document.service';

/**
 * Tab "Hình ảnh & Tài liệu" của hồ sơ bệnh nhân (docs/DECISIONS.md #299). Hai nhóm quyền độc lập: tệp lâm sàng (`patient_document.*`) và hợp đồng/giấy tờ
 * (`patient_contract.*`). Guard chỉ cần người dùng có MỘT trong hai nhóm (`alsoAccept`); service tự lọc danh sách và chặn thao tác theo nhóm của từng tệp.
 * Tệp đi theo bệnh nhân nên xem ở mọi chi nhánh; `@AuditView('patient')` ghi nhật ký "xem hồ sơ bệnh nhân" cho danh sách.
 */
@Controller('patients/:patientId/documents')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientDocumentController {
  constructor(private readonly service: PatientDocumentService) {}

  @Get()
  @RequirePermission('patient_document', 'read', { alsoAccept: [{ module: 'patient_contract', action: 'read' }] })
  @AuditView('patient', { paramName: 'patientId' })
  @UseInterceptors(AuditViewInterceptor)
  async list(@Param('patientId', ParseUUIDPipe) patientId: string, @Query() query: unknown, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.service.list(tenantId, userId, requireBranchId(req.user!), patientId, listPatientDocumentsQuerySchema.parse(query));
  }

  /** Lượt khám gần đây của bệnh nhân cho ô "Gắn với lượt khám" ở hộp tải lên/sửa. Khai báo TRƯỚC các route có `:id`. */
  @Get('encounter-options')
  @RequirePermission('patient_document', 'upload', { alsoAccept: [{ module: 'patient_contract', action: 'upload' }] })
  async encounterOptions(@Param('patientId', ParseUUIDPipe) patientId: string, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.service.encounterOptions(tenantId, userId, patientId);
  }

  /** Một tệp mỗi lần gọi (giao diện gửi lần lượt để hiện tiến độ và lỗi riêng từng tệp). Magic byte và dung lượng kiểm ở service. */
  @Post()
  @RequirePermission('patient_document', 'upload', { alsoAccept: [{ module: 'patient_contract', action: 'upload' }] })
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PATIENT_DOCUMENT_MAX_BYTES + 1 } }))
  async upload(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Thiếu tệp tải lên.');
    const form = uploadPatientDocumentFormSchema.parse(body);
    const { tenantId, userId } = req.user!;
    const requestKey = req.headers['idempotency-key'];
    return this.service.uploadOnce(tenantId, userId, requireBranchId(req.user!), patientId, form, file, Array.isArray(requestKey) ? requestKey[0] : requestKey, req.originalUrl.split('?')[0] ?? req.originalUrl, extractRequestMeta(req));
  }

  @Post('folders')
  @RequirePermission('patient_document', 'upload', { alsoAccept: [{ module: 'patient_contract', action: 'upload' }] })
  @HttpCode(200)
  async createFolder(@Param('patientId', ParseUUIDPipe) patientId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = createPatientDocumentFolderRequestSchema.parse(body);
    const { tenantId, userId } = req.user!;
    return this.service.createFolder(tenantId, userId, patientId, dto, extractRequestMeta(req));
  }

  @Patch('folders/:folderId')
  @RequirePermission('patient_document', 'upload', { alsoAccept: [{ module: 'patient_contract', action: 'upload' }] })
  async renameFolder(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const dto = renamePatientDocumentFolderRequestSchema.parse(body);
    const { tenantId, userId } = req.user!;
    return this.service.renameFolder(tenantId, userId, patientId, folderId, dto, extractRequestMeta(req));
  }

  @Delete('folders/:folderId')
  @RequirePermission('patient_document', 'upload', { alsoAccept: [{ module: 'patient_contract', action: 'upload' }] })
  async removeFolder(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    const { version } = removePatientDocumentFolderQuerySchema.parse(query);
    const { tenantId, userId } = req.user!;
    await this.service.removeFolder(tenantId, userId, patientId, folderId, version, extractRequestMeta(req));
    return { removed: true };
  }

  @Patch(':documentId')
  @RequirePermission('patient_document', 'upload', { alsoAccept: [{ module: 'patient_contract', action: 'upload' }] })
  async update(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const dto = updatePatientDocumentRequestSchema.parse(body);
    const { tenantId, userId } = req.user!;
    return this.service.update(tenantId, userId, patientId, documentId, dto, extractRequestMeta(req));
  }

  @Delete(':documentId')
  @RequirePermission('patient_document', 'delete', { alsoAccept: [{ module: 'patient_contract', action: 'delete' }] })
  async remove(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    const { version, reason } = removePatientDocumentQuerySchema.parse(query);
    const { tenantId, userId } = req.user!;
    await this.service.remove(tenantId, userId, patientId, documentId, version, reason, extractRequestMeta(req));
    return { removed: true };
  }
}
