import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  createUserAccountRequestSchema,
  listUserAccountsQuerySchema,
  resetUserPasswordRequestSchema,
  updateUserAccountRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { UserAccountService } from './user-account.service';

/** S2-07, ADM-01 — module `iam` sở hữu tài khoản/vai trò (.claude/docs/architecture.md). */
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UserAccountController {
  constructor(private readonly userAccountService: UserAccountService) {}

  @Post()
  @RequirePermission('user_account', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createUserAccountRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.userAccountService.createUserAccount(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Get()
  @RequirePermission('user_account', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listUserAccountsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.userAccountService.listUserAccounts(tenantId, dto);
  }

  @Get(':id')
  @RequirePermission('user_account', 'read', { entityIdParam: 'id' })
  async getById(@Param('id') id: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.userAccountService.getUserAccount(tenantId, id);
  }

  @Patch(':id')
  @RequirePermission('user_account', 'manage', { entityIdParam: 'id' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateUserAccountRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.userAccountService.updateUserAccount(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/reset-password')
  @RequirePermission('user_account', 'manage', { entityIdParam: 'id' })
  @HttpCode(200)
  async resetPassword(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = resetUserPasswordRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.userAccountService.resetPassword(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
