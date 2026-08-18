import { Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma, type UserAccount } from '@prisma/client';
import { ConcurrentModificationError, RoleInvalidReferenceError, UserAccountDuplicateUsernameError } from '@nexamed/core';
import type {
  CreateUserAccountRequest,
  ListUserAccountsQuery,
  ListUserAccountsResponse,
  ResetUserPasswordRequest,
  UpdateUserAccountRequest,
  UserAccountSummary,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { SessionRepository } from './session.repository';
import { UserAccountAuthRepository } from './user-account-auth.repository';
import { UserAccountRepository, type UpdateUserAccountData } from './user-account.repository';
import { RoleRepository } from './role.repository';

function isUsernameConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * CRUD tài khoản + gán vai trò (S2-07, ADM-01) — xem .claude/docs/coding-standards.md mục
 * "Tầng trong API". Đổi vai trò/vô hiệu hoá tài khoản thu hồi toàn bộ phiên đang mở
 * (.claude/docs/security-audit.md mục Xác thực; `SessionRepository.revokeAllForUser()` viết sẵn
 * từ S1-04 chờ đúng nơi gọi này, xem docs/DECISIONS.md #019).
 */
@Injectable()
export class UserAccountService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly userAccountRepository: UserAccountRepository,
    private readonly userAccountAuthRepository: UserAccountAuthRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly roleRepository: RoleRepository,
  ) {}

  async createUserAccount(
    tenantId: string,
    actorId: string,
    dto: CreateUserAccountRequest,
    meta: RequestMeta,
  ): Promise<UserAccountSummary> {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const roleIds = await this.roleRepository.findValidIds(tx, tenantId, dto.roleIds);
      if (roleIds.length !== dto.roleIds.length) {
        // roleId gửi lên không thuộc tenant này hoặc đã bị ẩn — lỗi input của client (client tự
        // ý gửi id lạ, hoặc vai trò vừa bị clinic_admin khác ẩn giữa lúc điền form), không phải
        // sự cố hạ tầng như khi roleNames còn là enum cố định trước ADM-07.
        throw new RoleInvalidReferenceError();
      }

      let created: UserAccount;
      try {
        created = await this.userAccountRepository.create(tx, tenantId, actorId, {
          username: dto.username,
          passwordHash,
          fullName: dto.fullName,
          licenseNo: dto.licenseNo ?? null,
          departmentId: dto.departmentId ?? null,
        });
      } catch (err) {
        if (isUsernameConflict(err)) {
          throw new UserAccountDuplicateUsernameError();
        }
        throw err;
      }

      await this.userAccountRepository.createUserRoles(tx, tenantId, actorId, created.id, roleIds);
      const roleNames = await this.userAccountAuthRepository.findRoleNamesForUser(tx, tenantId, created.id);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'user_account.created',
        entityType: 'user_account',
        entityId: created.id,
        afterJson: { username: created.username, roleNames },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created, roleNames);
    });
  }

  async getUserAccount(tenantId: string, id: string): Promise<UserAccountSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const user = await this.userAccountRepository.findById(tx, tenantId, id);
      if (!user) {
        throw new NotFoundException();
      }
      const roleNames = await this.userAccountAuthRepository.findRoleNamesForUser(tx, tenantId, id);
      return this.toSummary(user, roleNames);
    });
  }

  async listUserAccounts(tenantId: string, query: ListUserAccountsQuery): Promise<ListUserAccountsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.userAccountRepository.list(tx, tenantId, { cursor: query.cursor, take: query.limit + 1 });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? lastItem.id : null;

      // Quy mô nhân sự một phòng khám 1-3 bác sĩ rất nhỏ — chấp nhận N+1 truy vấn vai trò thay
      // vì tối ưu bằng join sớm cho quy mô chưa từng xảy ra (.claude/docs/coding-standards.md).
      const summaries = await Promise.all(
        items.map(async (user) => {
          const roleNames = await this.userAccountAuthRepository.findRoleNamesForUser(tx, tenantId, user.id);
          return this.toSummary(user, roleNames);
        }),
      );

      return { items: summaries, nextCursor };
    });
  }

  async updateUserAccount(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateUserAccountRequest,
    meta: RequestMeta,
  ): Promise<UserAccountSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.userAccountRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const patch: UpdateUserAccountData = {};
      if (dto.fullName !== undefined) patch.fullName = dto.fullName;
      if (dto.licenseNo !== undefined) patch.licenseNo = dto.licenseNo;
      if (dto.departmentId !== undefined) patch.departmentId = dto.departmentId;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const count = await this.userAccountRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      if (Object.keys(patch).length > 0) {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'user_account.updated',
          entityType: 'user_account',
          entityId: id,
          // `UpdateUserAccountData` chỉ có field JSON-safe (string/boolean/null) nhưng là
          // interface không có index signature nên TS không tự gán được vào Prisma.InputJsonValue
          // — ép kiểu có chủ đích, không phải để qua mặt lỗi thật.
          afterJson: patch as Prisma.InputJsonObject,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      if (dto.roleIds !== undefined) {
        const roleIds = await this.roleRepository.findValidIds(tx, tenantId, dto.roleIds);
        if (roleIds.length !== dto.roleIds.length) {
          throw new RoleInvalidReferenceError();
        }
        await this.userAccountRepository.softDeleteAllUserRoles(tx, tenantId, actorId, id);
        await this.userAccountRepository.createUserRoles(tx, tenantId, actorId, id, roleIds);
        const roleNames = await this.userAccountAuthRepository.findRoleNamesForUser(tx, tenantId, id);

        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'user_account.role_changed',
          entityType: 'user_account',
          entityId: id,
          afterJson: { roleNames },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      // .claude/docs/security-audit.md: "Đổi vai trò hoặc chuyển tenant thu hồi toàn bộ phiên
      // đang mở." `account_disabled` ưu tiên hơn nếu cả hai cùng xảy ra trong một request — lý do
      // rộng hơn (mất quyền truy cập hoàn toàn, không chỉ đổi phạm vi).
      if (dto.isActive === false) {
        await this.sessionRepository.revokeAllForUser(tx, tenantId, id, 'account_disabled', actorId);
      } else if (dto.roleIds !== undefined) {
        await this.sessionRepository.revokeAllForUser(tx, tenantId, id, 'role_changed', actorId);
      }

      const updated = await this.userAccountRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      const roleNames = await this.userAccountAuthRepository.findRoleNamesForUser(tx, tenantId, id);
      return this.toSummary(updated, roleNames);
    });
  }

  /** Đặt lại mật khẩu — tách riêng khỏi update hồ sơ thường (thao tác nhạy cảm, audit riêng). */
  async resetPassword(
    tenantId: string,
    actorId: string,
    id: string,
    dto: ResetUserPasswordRequest,
    meta: RequestMeta,
  ): Promise<UserAccountSummary> {
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.userAccountRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const count = await this.userAccountRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, {
        passwordHash,
      });
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      // Đặt lại mật khẩu phải thu hồi toàn bộ phiên đang mở — không thì kẻ đang giữ phiên cũ
      // (ví dụ máy bị mất) vẫn dùng được cho tới khi access token 15 phút hết hạn.
      await this.sessionRepository.revokeAllForUser(tx, tenantId, id, 'password_reset', actorId);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'user_account.password_reset',
        entityType: 'user_account',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.userAccountRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      const roleNames = await this.userAccountAuthRepository.findRoleNamesForUser(tx, tenantId, id);
      return this.toSummary(updated, roleNames);
    });
  }

  private toSummary(user: UserAccount, roleNames: readonly string[]): UserAccountSummary {
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      licenseNo: user.licenseNo,
      departmentId: user.departmentId,
      isActive: user.isActive,
      roleNames: [...roleNames],
      version: user.version,
    };
  }
}
