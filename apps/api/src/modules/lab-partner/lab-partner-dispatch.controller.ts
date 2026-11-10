import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  LAB_PARTNER_RESULT_MAX_BYTES,
  approveLabPartnerResultRequestSchema,
  listLabPartnerAwaitingQuerySchema,
  listLabPartnerQueueQuerySchema,
  receiveLabPartnerResultRequestSchema,
  rejectLabPartnerItemRequestSchema,
  returnLabPartnerResultRequestSchema,
  sendLabPartnerSamplesRequestSchema,
} from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { LabPartnerDispatchService } from './lab-partner-dispatch.service';
import { LabPartnerResultService } from './lab-partner-result.service';

/**
 * Hàng đợi "Gửi mẫu đối tác" (docs/DECISIONS.md #291) — theo CHI NHÁNH đang làm việc. `lab_partner.read` xem hàng đợi, `lab_partner.send` gửi mẫu đi.
 * Giá trả đối tác chỉ có số khi người gọi thấy được giá vốn (xem `canSeePartnerCost`); công tắc "Dùng đối tác xét nghiệm" tắt thì mọi route trả 409.
 */
@Controller('lab-partner-dispatch')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LabPartnerDispatchController {
  constructor(
    private readonly service: LabPartnerDispatchService,
    private readonly resultService: LabPartnerResultService,
  ) {}

  @Get('pending')
  @RequirePermission('lab_partner', 'read')
  async pending(@Query() query: unknown, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.service.listPending(tenantId, userId, requireBranchId(req.user!), listLabPartnerQueueQuerySchema.parse(query));
  }

  @Get('sent')
  @RequirePermission('lab_partner', 'read')
  async sent(@Query() query: unknown, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.service.listSent(tenantId, userId, requireBranchId(req.user!), listLabPartnerQueueQuerySchema.parse(query));
  }

  @Get('counts')
  @RequirePermission('lab_partner', 'read')
  async counts(@Req() req: Request) {
    return this.resultService.getCounts(req.user!.tenantId, requireBranchId(req.user!));
  }

  /** Kết quả đối tác chờ bác sĩ duyệt (khối ở màn khám và Tổng quan bác sĩ). Công tắc tắt thì trả danh sách rỗng. */
  @Get('awaiting')
  @RequirePermission('lab_partner', 'read')
  async awaiting(@Query() query: unknown, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.resultService.listAwaiting(tenantId, userId, requireBranchId(req.user!), listLabPartnerAwaitingQuerySchema.parse(query));
  }

  @Get('done')
  @RequirePermission('lab_partner', 'read')
  async done(@Query() query: unknown, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.resultService.listDone(tenantId, userId, requireBranchId(req.user!), listLabPartnerQueueQuerySchema.parse(query));
  }

  /** Nhận kết quả: multipart — trường `file` là PDF, trường `data` là JSON `{ itemIds, receivedAt?, note? }`. */
  @Post('results')
  @RequirePermission('lab_partner', 'receive')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LAB_PARTNER_RESULT_MAX_BYTES } }))
  async receive(@UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @Body() body: { data?: string }, @Req() req: Request) {
    let raw: unknown;
    try {
      raw = typeof body?.data === 'string' ? JSON.parse(body.data) : undefined;
    } catch {
      throw new BadRequestException('Thông tin kèm theo tệp không hợp lệ.');
    }
    const dto = receiveLabPartnerResultRequestSchema.parse(raw);
    const { tenantId, userId } = req.user!;
    return this.resultService.receive(tenantId, userId, requireBranchId(req.user!), dto, file, extractRequestMeta(req));
  }

  @Post('items/:itemId/reject')
  @RequirePermission('lab_partner', 'receive')
  @HttpCode(200)
  async reject(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectLabPartnerItemRequestSchema.parse(body);
    const { tenantId, userId } = req.user!;
    await this.resultService.reject(tenantId, userId, requireBranchId(req.user!), itemId, dto, extractRequestMeta(req));
    return { ok: true };
  }

  /** Bác sĩ duyệt kết quả đối tác — quyền Duyệt kết quả xét nghiệm (`lab_result.approve`), như duyệt kết quả thường. */
  @Post('items/:itemId/approve')
  @RequirePermission('lab_result', 'approve')
  @HttpCode(200)
  async approve(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = approveLabPartnerResultRequestSchema.parse(body ?? {});
    const { tenantId, userId } = req.user!;
    await this.resultService.approve(tenantId, userId, requireBranchId(req.user!), itemId, dto, extractRequestMeta(req));
    return { ok: true };
  }

  @Post('items/:itemId/return')
  @RequirePermission('lab_partner', 'receive')
  @HttpCode(200)
  async returnResult(@Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = returnLabPartnerResultRequestSchema.parse(body);
    const { tenantId, userId } = req.user!;
    await this.resultService.returnToTechnician(tenantId, userId, requireBranchId(req.user!), itemId, dto, extractRequestMeta(req));
    return { ok: true };
  }

  @Post()
  @RequirePermission('lab_partner', 'send')
  @HttpCode(200)
  async send(@Body() body: unknown, @Req() req: Request) {
    const dto = sendLabPartnerSamplesRequestSchema.parse(body);
    const { tenantId, userId } = req.user!;
    return this.service.send(tenantId, userId, requireBranchId(req.user!), dto, extractRequestMeta(req));
  }
}
