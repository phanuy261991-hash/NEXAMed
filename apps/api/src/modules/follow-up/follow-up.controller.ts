import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createFollowUpReminderRequestSchema, listFollowUpsQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { FollowUpService } from './follow-up.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Trang "Hẹn tái khám" (docs/DECISIONS.md #285). Xem: `follow_up.read` (lễ tân/quản trị toàn bộ, bác sĩ chỉ hẹn của lượt khám do mình khám — phạm vi `personal` do service áp);
 * ghi lần nhắc: `follow_up.remind`. Route cố định (`export`) khai báo TRƯỚC route có tham số.
 */
@Controller('follow-ups')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FollowUpController {
  constructor(private readonly followUpService: FollowUpService) {}

  @Get()
  @RequirePermission('follow_up', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    return this.followUpService.list(req.user!, req.dataScope!, listFollowUpsQuerySchema.parse(query));
  }

  @Get('export')
  @RequirePermission('follow_up', 'read')
  async export(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    // Xuất Excel không phân trang: bỏ `cursor`/`limit` khỏi bộ lọc.
    const filter = listFollowUpsQuerySchema.omit({ cursor: true, limit: true }).parse(query);
    const buffer = await this.followUpService.exportExcel(req.user!, req.dataScope!, filter);
    await this.followUpService.recordExportAudit(req.user!, filter, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="hen-tai-kham-${filter.tab}.xlsx"`);
    res.send(buffer);
  }

  @Get(':encounterId/reminders')
  @RequirePermission('follow_up', 'read')
  async listReminders(@Param('encounterId', new ParseUUIDPipe()) encounterId: string, @Req() req: Request) {
    return this.followUpService.listReminders(req.user!, req.dataScope!, encounterId);
  }

  @Post(':encounterId/reminders')
  @HttpCode(200)
  @RequirePermission('follow_up', 'remind')
  async createReminder(@Param('encounterId', new ParseUUIDPipe()) encounterId: string, @Body() body: unknown, @Req() req: Request) {
    return this.followUpService.createReminder(req.user!, req.dataScope!, encounterId, createFollowUpReminderRequestSchema.parse(body), extractRequestMeta(req));
  }
}
