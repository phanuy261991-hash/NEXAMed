import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma, type UserAccount } from '@prisma/client';
import {
  ConcurrentModificationError,
  formatDisplayCode,
  REFERENCE_CATALOG_READER_PORT,
  resolveAccountActiveState,
  RoleInvalidReferenceError,
  UserAccountDuplicateUsernameError,
  type ReferenceCatalogReaderPort,
} from '@nexamed/core';
import type {
  CreateUserAccountRequest,
  ListUserAccountsQuery,
  ListUserAccountsResponse,
  ResetUserPasswordRequest,
  UpdateUserAccountRequest,
  UserAccountSummary,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { SessionRepository } from './session.repository';
import { UserAccountAuthRepository } from './user-account-auth.repository';
import { UserAccountRepository, type UpdateUserAccountData } from './user-account.repository';
import { RoleRepository } from './role.repository';

function isUsernameConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const EMPLOYEE_CODE_PREFIX = 'NV';
const EMPLOYMENT_STATUS_CATEGORY = 'EMPLOYMENT_STATUS';

/**
 * CRUD tài khoản + gán vai trò (S2-07, ADM-01) — xem .claude/docs/coding-standards.md mục
 * "Tầng trong API". Đổi vai trò/vô hiệu hoá tài khoản thu hồi toàn bộ phiên đang mở
 * (.claude/docs/security-audit.md mục Xác thực; `SessionRepository.revokeAllForUser()` viết sẵn
 * từ S1-04 chờ đúng nơi gọi này, xem docs/DECISIONS.md #019).
 *
 * Mở rộng ADM-01 (hồ sơ nhân sự): `employeeCode` sinh qua `CodeSequenceRepository` đúng khuôn
 * `PATIENT_CODE_PREFIX` (`patient.service.ts`). Trạng thái làm việc tự-vô-hiệu-hoá tài khoản (ví
 * dụ "Nghỉ việc") đọc qua `ReferenceCatalogReaderPort` — xem `resolveAccountActiveState`.
 */
@Injectable()
export class UserAccountService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly userAccountRepository: UserAccountRepository,
    private readonly userAccountAuthRepository: UserAccountAuthRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly roleRepository: RoleRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
  ) {}

  /** `null` khi `employmentStatusCode` không truyền — không tra cứu, coi như không có trạng thái. */
  private async resolveEmploymentStatus(
    tenantId: string,
    employmentStatusCode: string | null | undefined,
  ): Promise<{ deactivatesAccount: boolean } | null> {
    if (!employmentStatusCode) {
      return null;
    }
    return this.referenceCatalogReader.findActiveByCode(tenantId, EMPLOYMENT_STATUS_CATEGORY, employmentStatusCode);
  }

  async createUserAccount(
    tenantId: string,
    actorId: string,
    dto: CreateUserAccountRequest,
    meta: RequestMeta,
  ): Promise<UserAccountSummary> {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    // Tra Trạng thái làm việc TRƯỚC khi mở transaction ghi — `ReferenceCatalogReaderPort` tự mở
    // transaction riêng của chính nó (đúng khuôn DoctorDirectoryPort/ClinicConfigReaderPort, luôn
    // gọi ĐỘC LẬP bên ngoài mọi transaction khác). Gọi port này TỪ BÊN TRONG
    // `unitOfWork.runInTenantScope` sẽ mở một transaction Prisma thứ hai lồng bên trong transaction
    // đang chạy — Prisma không hỗ trợ nested transaction thật, gây tranh chấp connection pool/
    // deadlock (phát hiện thật lúc chạy test HTTP e2e, không phải suy đoán).
    const employmentStatus = await this.resolveEmploymentStatus(tenantId, dto.employmentStatusCode);
    // Tạo mới không có trường `isActive` (luôn mặc định true) — `resolveAccountActiveState`
    // không ném lỗi ở nhánh này (explicit=undefined), chỉ lặng lẽ tạo tài khoản vô hiệu nếu
    // Trạng thái làm việc chọn sẵn thuộc nhóm tự-vô-hiệu-hoá (nhập liệu lịch sử).
    const isActive = resolveAccountActiveState(employmentStatus, undefined, true);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const roleIds = await this.roleRepository.findValidIds(tx, tenantId, dto.roleIds);
      if (roleIds.length !== dto.roleIds.length) {
        // roleId gửi lên không thuộc tenant này hoặc đã bị ẩn — lỗi input của client (client tự
        // ý gửi id lạ, hoặc vai trò vừa bị clinic_admin khác ẩn giữa lúc điền form), không phải
        // sự cố hạ tầng như khi roleNames còn là enum cố định trước ADM-07.
        throw new RoleInvalidReferenceError();
      }

      const seq = await this.codeSequenceRepository.next(tx, tenantId, EMPLOYEE_CODE_PREFIX, actorId);
      const employeeCode = formatDisplayCode(EMPLOYEE_CODE_PREFIX, new Date(), seq);

      let created: UserAccount;
      try {
        created = await this.userAccountRepository.create(tx, tenantId, actorId, {
          username: dto.username,
          passwordHash,
          fullName: dto.fullName,
          licenseNo: dto.licenseNo ?? null,
          departmentId: dto.departmentId ?? null,
          employeeCode,
          phone: dto.phone ?? null,
          personalEmail: dto.personalEmail ?? null,
          companyEmail: dto.companyEmail ?? null,
          academicTitleCode: dto.academicTitleCode ?? null,
          positionCode: dto.positionCode ?? null,
          employmentStatusCode: dto.employmentStatusCode ?? null,
          employmentTypeCode: dto.employmentTypeCode ?? null,
          canSignMedicalRecord: dto.canSignMedicalRecord ?? false,
          mustChangePassword: dto.mustChangePassword ?? false,
          isActive,
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
    // Đọc tài khoản hiện có + tra Trạng thái làm việc (nếu cần) TRƯỚC khi mở transaction ghi —
    // cùng lý do đã ghi ở `createUserAccount`: `ReferenceCatalogReaderPort` tự mở transaction
    // riêng, gọi nó từ bên trong transaction ghi sẽ gây nested transaction (deadlock/tranh chấp
    // connection pool, phát hiện thật lúc chạy test). Không phá optimistic locking: chỉ đọc
    // trước để TÍNH patch, còn `updateIfVersionMatches` (bên dưới, trong transaction ghi) vẫn
    // khoá đúng `WHERE version = ?` — dữ liệu đổi giữa lúc đọc và lúc ghi sẽ tự trả
    // CONCURRENT_MODIFICATION như bình thường, không có khoảng hở đúng-sai.
    const existing = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.userAccountRepository.findById(tx, tenantId, id));
    if (!existing) {
      throw new NotFoundException();
    }

    const patch: UpdateUserAccountData = {};
    if (dto.fullName !== undefined) patch.fullName = dto.fullName;
    if (dto.licenseNo !== undefined) patch.licenseNo = dto.licenseNo;
    if (dto.departmentId !== undefined) patch.departmentId = dto.departmentId;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.personalEmail !== undefined) patch.personalEmail = dto.personalEmail;
    if (dto.companyEmail !== undefined) patch.companyEmail = dto.companyEmail;
    if (dto.academicTitleCode !== undefined) patch.academicTitleCode = dto.academicTitleCode;
    if (dto.positionCode !== undefined) patch.positionCode = dto.positionCode;
    if (dto.employmentTypeCode !== undefined) patch.employmentTypeCode = dto.employmentTypeCode;
    if (dto.canSignMedicalRecord !== undefined) patch.canSignMedicalRecord = dto.canSignMedicalRecord;

    // Chỉ tính lại isActive khi client thật sự đổi employmentStatusCode HOẶC gửi isActive tường
    // minh — tránh mọi lần sửa hồ sơ (ví dụ chỉ đổi SĐT) đều ghi đè isActive vào patch/audit dù
    // không đổi gì. `resolveAccountActiveState` ném lỗi nếu client cố ép isActive:true trong
    // khi Trạng thái làm việc (mới hoặc giữ nguyên) vẫn tự-vô-hiệu-hoá.
    if (dto.employmentStatusCode !== undefined || dto.isActive !== undefined) {
      patch.employmentStatusCode = dto.employmentStatusCode;
      const effectiveStatusCode = dto.employmentStatusCode !== undefined ? dto.employmentStatusCode : existing.employmentStatusCode;
      const employmentStatus = await this.resolveEmploymentStatus(tenantId, effectiveStatusCode);
      patch.isActive = resolveAccountActiveState(employmentStatus, dto.isActive, existing.isActive);
    }

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
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
      // rộng hơn (mất quyền truy cập hoàn toàn, không chỉ đổi phạm vi). Dùng `patch.isActive`
      // (giá trị CUỐI CÙNG đã tính qua `resolveAccountActiveState`) — không phải `dto.isActive`
      // thô, vì Trạng thái làm việc "Nghỉ việc" có thể tự ép `false` dù client không gửi
      // `isActive` (mở rộng ADM-01).
      if (patch.isActive === false) {
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
        ...(dto.mustChangePassword !== undefined ? { mustChangePassword: dto.mustChangePassword } : {}),
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
      employeeCode: user.employeeCode,
      username: user.username,
      fullName: user.fullName,
      phone: user.phone,
      personalEmail: user.personalEmail,
      companyEmail: user.companyEmail,
      licenseNo: user.licenseNo,
      academicTitleCode: user.academicTitleCode,
      positionCode: user.positionCode,
      employmentStatusCode: user.employmentStatusCode,
      employmentTypeCode: user.employmentTypeCode,
      canSignMedicalRecord: user.canSignMedicalRecord,
      mustChangePassword: user.mustChangePassword,
      departmentId: user.departmentId,
      isActive: user.isActive,
      roleNames: [...roleNames],
      version: user.version,
    };
  }
}
