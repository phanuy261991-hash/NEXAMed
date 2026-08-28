import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  amendClinicalNoteRequestSchema,
  amendDiagnosesRequestSchema,
  amendPrescriptionRequestSchema,
  cancelEncounterRequestSchema,
  completeConsultationRequestSchema,
  releaseEncounterRequestSchema,
  saveClinicalNoteRequestSchema,
  saveDiagnosesRequestSchema,
  savePrescriptionItemsRequestSchema,
  signPrescriptionRequestSchema,
  startConsultationRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { EncounterService } from './encounter.service';

/** Transition endpoints của lượt khám (Sprint 3) — tạo encounter (check-in) thuộc `reception.controller.ts`, không phải đây. */
@Controller('encounters')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class EncounterController {
  constructor(private readonly encounterService: EncounterService) {}

  @Post(':id/start')
  @RequirePermission('encounter', 'update', { entityIdParam: 'id' })
  @HttpCode(200)
  async start(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = startConsultationRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.startConsultation(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/cancel')
  @RequirePermission('encounter', 'cancel', { entityIdParam: 'id' })
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = cancelEncounterRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.cancelEncounter(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** #085 "Trả về hàng chờ" — bác sĩ nhả ca (nhận nhầm/bận đột xuất), dùng chung quyền `encounter.update` với "Bắt đầu khám". */
  @Post(':id/release')
  @RequirePermission('encounter', 'update', { entityIdParam: 'id' })
  @HttpCode(200)
  async release(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = releaseEncounterRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.releaseEncounter(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** Màn hình khám (S3-05) — gộp tiền sử + dị ứng + sinh hiệu trong một request. */
  @Get(':id/consultation')
  @RequirePermission('encounter', 'read', { entityIdParam: 'id' })
  async getConsultation(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.encounterService.getConsultationDetail(tenantId, userId, req.dataScope!, id);
  }

  @Put(':id/diagnoses')
  @RequirePermission('diagnosis', 'create', { entityIdParam: 'id' })
  async saveDiagnoses(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveDiagnosesRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.saveDiagnoses(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Put(':id/clinical-note')
  @RequirePermission('clinical_note', 'create', { entityIdParam: 'id' })
  async saveClinicalNote(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = saveClinicalNoteRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.saveClinicalNote(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** "Đính chính chẩn đoán" (Sprint 5, S5-02/03) — chỉ khi đã ký (`status=COMPLETED`), bắt buộc lý do. */
  @Post(':id/diagnoses/amend')
  @RequirePermission('diagnosis', 'sign', { entityIdParam: 'id' })
  @HttpCode(200)
  async amendDiagnoses(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = amendDiagnosesRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.amendDiagnoses(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** "Đính chính ghi chú khám" (Sprint 5, S5-02/03) — chỉ khi đã ký, chỉ sửa đúng section đổi nội dung. */
  @Post(':id/clinical-note/amend')
  @RequirePermission('clinical_note', 'sign', { entityIdParam: 'id' })
  @HttpCode(200)
  async amendClinicalNote(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = amendClinicalNoteRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.amendClinicalNote(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** "Hoàn tất khám" — IN_CONSULTATION → COMPLETED, chỉ yêu cầu đúng một chẩn đoán chính. Ký hồ sơ khám ngay trong cùng transaction (Sprint 5, S5-02/03). */
  @Post(':id/complete')
  @RequirePermission('encounter', 'update', { entityIdParam: 'id' })
  @HttpCode(200)
  async complete(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = completeConsultationRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.completeConsultation(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** Kê đơn (Sprint 4, S4-01/02) — thay thế toàn bộ dòng thuốc của đơn NHÁP hiện tại. */
  @Put(':id/prescription-items')
  @RequirePermission('prescription', 'create', { entityIdParam: 'id' })
  async savePrescriptionItems(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = savePrescriptionItemsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.savePrescriptionItems(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** Ký đơn thuốc — sau khi ký đơn bất biến (trigger C8 chặn UPDATE), sửa = "Sửa đơn" (đính chính). */
  @Post(':id/prescription/sign')
  @RequirePermission('prescription', 'sign', { entityIdParam: 'id' })
  @HttpCode(200)
  async signPrescription(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = signPrescriptionRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.signPrescription(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** In đơn (PRE-04) — ghi nhận `printedAt`, idempotent. Bố cục in nằm ở tầng web. */
  @Post(':id/prescription/print')
  @RequirePermission('prescription', 'print', { entityIdParam: 'id' })
  @HttpCode(200)
  async printPrescription(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.encounterService.markPrescriptionPrinted(tenantId, userId, req.dataScope!, id, extractRequestMeta(req));
  }

  /** "Sửa đơn" — đính chính đơn đã ký, tạo đơn mới đã ký ngay, bắt buộc lý do. */
  @Post(':id/prescription/amend')
  @RequirePermission('prescription', 'sign', { entityIdParam: 'id' })
  @HttpCode(200)
  async amendPrescription(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = amendPrescriptionRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.encounterService.amendPrescription(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }
}
