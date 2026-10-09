import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PARACLINICAL_GROUP_KINDS, PARACLINICAL_GROUP_PERMISSION_MODULE } from '@nexamed/core';
import {
  collectSpecimenTubesRequestSchema,
  lookupSpecimenTubeQuerySchema,
  printSpecimenTubesRequestSchema,
  recollectSpecimenTubeRequestSchema,
  splitSpecimenTubeRequestSchema,
  uncollectSpecimenTubesRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import type { ResultAccessScope } from './paraclinical-result.service';
import { SpecimenTubeService } from './specimen-tube.service';

const scopeOf = (req: Request): ResultAccessScope => ({ dataScope: req.dataScope!, kinds: PARACLINICAL_GROUP_KINDS.lab, permissionModule: PARACLINICAL_GROUP_PERMISSION_MODULE.lab });

/**
 * Lấy mẫu xét nghiệm có ống mẫu, mã ống (SID) và tem mã vạch (docs/DECISIONS.md #220) — cùng menu "Xét nghiệm" nên cùng quyền `lab_result.*` (`enter` cho mọi thao tác ghi, `read` để tra mã ống).
 * Mọi thao tác trả `{ state }` = trạng thái hộp thoại lấy mẫu của phiếu để web vẽ lại.
 */
@Controller('paraclinical/lab')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class SpecimenTubeController {
  constructor(private readonly service: SpecimenTubeService) {}

  /** Mở hộp thoại "Lấy mẫu" của phiếu: sinh ống + SID cho xét nghiệm chưa có ống (idempotent). */
  @Post('orders/:orderId/specimen-collection/open')
  @RequirePermission('lab_result', 'enter')
  @HttpCode(200)
  async open(@Param('orderId', ParseUUIDPipe) orderId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return { state: await this.service.open(tenantId, userId, scopeOf(req), orderId, extractRequestMeta(req)) };
  }

  /** Tra mã ống — ô "Quét mã ống" (súng quét USB gõ mã + Enter). */
  @Get('specimen-tubes/lookup')
  @RequirePermission('lab_result', 'read')
  async lookup(@Query() query: unknown, @Req() req: Request) {
    const { sid } = lookupSpecimenTubeQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.service.lookup(tenantId, userId, scopeOf(req), sid);
  }

  @Post('specimen-tubes/print')
  @RequirePermission('lab_result', 'enter')
  @HttpCode(200)
  async print(@Body() body: unknown, @Req() req: Request) {
    const dto = printSpecimenTubesRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { state: await this.service.print(tenantId, userId, scopeOf(req), dto, extractRequestMeta(req)) };
  }

  @Post('specimen-tubes/collect')
  @RequirePermission('lab_result', 'enter')
  @HttpCode(200)
  async collect(@Body() body: unknown, @Req() req: Request) {
    const dto = collectSpecimenTubesRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { state: await this.service.collect(tenantId, userId, scopeOf(req), dto, extractRequestMeta(req)) };
  }

  @Post('specimen-tubes/uncollect')
  @RequirePermission('lab_result', 'enter')
  @HttpCode(200)
  async uncollect(@Body() body: unknown, @Req() req: Request) {
    const dto = uncollectSpecimenTubesRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { state: await this.service.uncollect(tenantId, userId, scopeOf(req), dto, extractRequestMeta(req)) };
  }

  @Post('specimen-tubes/:tubeId/split')
  @RequirePermission('lab_result', 'enter')
  @HttpCode(200)
  async split(@Param('tubeId', ParseUUIDPipe) tubeId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = splitSpecimenTubeRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { state: await this.service.split(tenantId, userId, scopeOf(req), tubeId, dto, extractRequestMeta(req)) };
  }

  @Post('specimen-tubes/:tubeId/recollect')
  @RequirePermission('lab_result', 'enter')
  @HttpCode(200)
  async recollect(@Param('tubeId', ParseUUIDPipe) tubeId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = recollectSpecimenTubeRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return { state: await this.service.recollect(tenantId, userId, scopeOf(req), tubeId, dto, extractRequestMeta(req)) };
  }
}
