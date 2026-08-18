import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { listIcd10CodesQuerySchema, listIcd10GroupsQuerySchema, searchIcd10QuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { Icd10Service } from './icd10.service';

/**
 * Danh mục ICD-10 toàn hệ thống, read-only (S3-01, mở khoá một phần — bổ sung dần theo chương). Dùng lại
 * quyền `patient.read` thay vì thêm permission mới — đúng lý do đã chốt ở `geo.controller.ts`
 * (tránh vấn đề "chưa có cơ chế backfill role_permission cho tenant cũ" khi thêm permission mới).
 */
@Controller('icd10')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class Icd10Controller {
  constructor(private readonly icd10Service: Icd10Service) {}

  @Get('chapters')
  @RequirePermission('patient', 'read')
  async listChapters(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.icd10Service.listChapters(tenantId);
  }

  @Get('groups')
  @RequirePermission('patient', 'read')
  async listGroups(@Query('chapterCode') chapterCode: string | undefined, @Req() req: Request) {
    const { chapterCode: parsed } = listIcd10GroupsQuerySchema.parse({ chapterCode });
    const { tenantId } = req.user!;
    return this.icd10Service.listGroups(tenantId, parsed);
  }

  @Get('codes')
  @RequirePermission('patient', 'read')
  async listCodes(@Query('groupCode') groupCode: string | undefined, @Req() req: Request) {
    const { groupCode: parsed } = listIcd10CodesQuerySchema.parse({ groupCode });
    const { tenantId } = req.user!;
    return this.icd10Service.listCodes(tenantId, parsed);
  }

  @Get()
  @RequirePermission('patient', 'read')
  async search(@Query('q') q: string | undefined, @Req() req: Request) {
    const { q: parsed } = searchIcd10QuerySchema.parse({ q });
    const { tenantId } = req.user!;
    return this.icd10Service.search(tenantId, parsed);
  }
}