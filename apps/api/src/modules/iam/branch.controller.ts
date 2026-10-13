import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createBranchRequestSchema, listBranchesQuerySchema, updateBranchRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { BranchService } from './branch.service';

/** Quản trị "Chi nhánh" (docs/DECISIONS.md #231) — `branch.read`/`branch.manage`, mặc định chỉ clinic_admin. Danh sách chi nhánh của CHÍNH MÌNH ở `/auth/me`. */
@Controller('branches')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Get()
  @RequirePermission('branch', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const { includeInactive } = listBranchesQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.branchService.list(tenantId, includeInactive);
  }

  @Post()
  @RequirePermission('branch', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createBranchRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.branchService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('branch', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateBranchRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.branchService.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
