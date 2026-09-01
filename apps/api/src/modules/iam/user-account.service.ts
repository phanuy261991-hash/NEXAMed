import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { Prisma, type UserAccount } from '@prisma/client';
import {
  ConcurrentModificationError,
  formatDisplayCode,
  InvalidSignatureError,
  REFERENCE_CATALOG_READER_PORT,
  resolveAccountActiveState,
  RoleInvalidReferenceError,
  sniffImageExtension,
  STORAGE_PORT,
  UserAccountDuplicateUsernameError,
  type ReferenceCatalogReaderPort,
  type StoragePort,
} from '@nexamed/core';
import type {
  CreateUserAccountRequest,
  ListUserAccountsQuery,
  ListUserAccountsResponse,
  ResetUserPasswordRequest,
  UpdateOwnProfileRequest,
  UpdateUserAccountRequest,
  UserAccountGender,
  UserAccountSummary,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { signFileToken } from '../../infrastructure/storage/signed-url';
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
/** Chữ ký sống 15 phút — bằng access token TTL, cùng khuôn `PHOTO_URL_TTL_SECONDS` ở `patient.service.ts`. */
const SIGNATURE_URL_TTL_SECONDS = 15 * 60;
/** Cũng dùng ở `user-account.controller.ts` (giới hạn `FileInterceptor`) — ảnh chữ ký nhỏ hơn ảnh đại diện, giới hạn chặt hơn `MAX_PHOTO_SIZE_BYTES` (3MB). */
export const MAX_SIGNATURE_SIZE_BYTES = 1 * 1024 * 1024;

/**
 * CRUD tài khoản + gán vai trò (S2-07, ADM-01) — xem .claude/docs/coding-standards.md mục
 * "Tầng trong API". Đổi vai trò/vô hiệu hoá tài khoản thu hồi toàn bộ phiên đang mở
 * (.claude/docs/security-audit.md mục Xác thực; `SessionRepository.revokeAllForUser()` viết sẵn
 * từ S1-04 chờ đúng nơi gọi này, xem docs/DECISIONS.md #019).
 *
 * Mở rộng ADM-01 (hồ sơ nhân sự): `employeeCode` sinh qua `CodeSequenceRepository` đúng khuôn
 * `PATIENT_CODE_PREFIX` (`patient.service.ts`). Trạng thái làm việc tự-vô-hiệu-hoá tài khoản (ví
 * dụ "Nghỉ việc") đọc qua `ReferenceCatalogReaderPort` — xem `resolveAccountActiveState`.
 *
 * Redesign 3-tab (#082, 2026-08-27): thêm hồ sơ cá nhân/pháp lý (dob/gender/CCHN) + upload chữ ký
 * (`uploadSignature`, đúng khuôn `PatientService.uploadPhoto` — CHỈ nhận PNG, khác patient nhận cả
 * JPG) + "Phòng khám mặc định" (`defaultRoomId`, composite FK tới `room`, không validate tồn tại
 * trước — cùng cách đã làm với `departmentId`, lỗi FK client tự gửi id lạ hiếm khi xảy ra qua UI
 * thật vì Combobox chỉ load từ danh sách có sẵn).
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
    private readonly configService: ConfigService,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
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
          displayName: dto.displayName,
          licenseNo: dto.licenseNo ?? null,
          licenseIssuedAt: dto.licenseIssuedAt ? new Date(dto.licenseIssuedAt) : null,
          licenseIssuedPlace: dto.licenseIssuedPlace ?? null,
          departmentId: dto.departmentId ?? null,
          defaultRoomId: dto.defaultRoomId ?? null,
          employeeCode,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          dob: dto.dob ? new Date(dto.dob) : null,
          gender: dto.gender ?? null,
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
    if (dto.displayName !== undefined) patch.displayName = dto.displayName;
    if (dto.licenseNo !== undefined) patch.licenseNo = dto.licenseNo;
    if (dto.licenseIssuedAt !== undefined) patch.licenseIssuedAt = dto.licenseIssuedAt ? new Date(dto.licenseIssuedAt) : null;
    if (dto.licenseIssuedPlace !== undefined) patch.licenseIssuedPlace = dto.licenseIssuedPlace;
    if (dto.departmentId !== undefined) patch.departmentId = dto.departmentId;
    if (dto.defaultRoomId !== undefined) patch.defaultRoomId = dto.defaultRoomId;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.dob !== undefined) patch.dob = dto.dob ? new Date(dto.dob) : null;
    if (dto.gender !== undefined) patch.gender = dto.gender;
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

  /**
   * Tự sửa hồ sơ CÁ NHÂN của chính mình (menu avatar "Thông tin tài khoản") — CHỈ nhận đúng 4
   * trường liên hệ (`UpdateOwnProfileRequest`), không đi qua `updateUserAccount()` (nhận DTO rộng
   * hơn nhiều, đủ để đổi vai trò/trạng thái làm việc/hồ sơ pháp lý) để không có cách nào tự nới
   * quyền qua endpoint này dù có sửa lại code gọi từ client. `id === actorId` luôn đúng (route
   * `PATCH /users/me` lấy id thẳng từ token, không nhận tham số) — không cần kiểm tra scope.
   */
  async updateOwnProfile(tenantId: string, actorId: string, dto: UpdateOwnProfileRequest, meta: RequestMeta): Promise<UserAccountSummary> {
    const patch: UpdateUserAccountData = {};
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.dob !== undefined) patch.dob = dto.dob ? new Date(dto.dob) : null;
    if (dto.gender !== undefined) patch.gender = dto.gender;

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.userAccountRepository.updateIfVersionMatches(tx, tenantId, actorId, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      if (Object.keys(patch).length > 0) {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'user_account.self_updated',
          entityType: 'user_account',
          entityId: actorId,
          afterJson: patch as Prisma.InputJsonObject,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      const updated = await this.userAccountRepository.findById(tx, tenantId, actorId);
      if (!updated) {
        throw new NotFoundException();
      }
      const roleNames = await this.userAccountAuthRepository.findRoleNamesForUser(tx, tenantId, actorId);
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

  /**
   * Upload/thay ảnh chữ ký (redesign 3-tab #082) — đúng khuôn `PatientService.uploadPhoto`, CHỈ
   * nhận PNG (khác patient nhận cả JPG — chữ ký cần nền trong suốt). Chỉ gọi được sau khi tài
   * khoản đã tồn tại (cần `id` để đặt tên key), cùng ràng buộc `patient.photoKey`.
   */
  async uploadSignature(
    tenantId: string,
    actorId: string,
    id: string,
    expectedVersion: number,
    fileBuffer: Buffer,
    meta: RequestMeta,
  ): Promise<UserAccountSummary> {
    if (fileBuffer.byteLength > MAX_SIGNATURE_SIZE_BYTES) {
      throw new InvalidSignatureError('Ảnh chữ ký vượt quá 1MB, vui lòng chọn ảnh nhỏ hơn.');
    }
    const extension = sniffImageExtension(fileBuffer);
    if (extension !== 'png') {
      throw new InvalidSignatureError('Chỉ nhận ảnh chữ ký định dạng PNG.');
    }

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.userAccountRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const key = `user_account/${id}/signature/${randomUUID()}.png`;
      await this.storage.save(tenantId, key, fileBuffer, 'image/png');

      const updatedCount = await this.userAccountRepository.updateIfVersionMatches(tx, tenantId, id, expectedVersion, actorId, {
        signatureKey: key,
      });
      if (updatedCount === 0) {
        // Ảnh mới đã lưu nhưng cột chưa đổi — dọn ngay, không để rác không ai trỏ tới.
        await this.storage.delete(tenantId, key);
        throw new ConcurrentModificationError();
      }

      if (existing.signatureKey) {
        await this.storage.delete(tenantId, existing.signatureKey);
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'user_account.signature_updated',
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

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private signSignatureUrl(tenantId: string, key: string): string {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    const exp = Math.floor(Date.now() / 1000) + SIGNATURE_URL_TTL_SECONDS;
    const token = signFileToken({ tenantId, key, exp }, encryptionKey);
    return `/api/v1/files/${token}`;
  }

  private toSummary(user: UserAccount, roleNames: readonly string[]): UserAccountSummary {
    return {
      id: user.id,
      employeeCode: user.employeeCode,
      username: user.username,
      fullName: user.fullName,
      displayName: user.displayName,
      phone: user.phone,
      email: user.email,
      dob: user.dob ? this.formatDate(user.dob) : null,
      gender: user.gender as UserAccountGender | null,
      licenseNo: user.licenseNo,
      licenseIssuedAt: user.licenseIssuedAt ? this.formatDate(user.licenseIssuedAt) : null,
      licenseIssuedPlace: user.licenseIssuedPlace,
      academicTitleCode: user.academicTitleCode,
      positionCode: user.positionCode,
      employmentStatusCode: user.employmentStatusCode,
      employmentTypeCode: user.employmentTypeCode,
      canSignMedicalRecord: user.canSignMedicalRecord,
      mustChangePassword: user.mustChangePassword,
      departmentId: user.departmentId,
      defaultRoomId: user.defaultRoomId,
      signatureUrl: user.signatureKey ? this.signSignatureUrl(user.tenantId, user.signatureKey) : null,
      isActive: user.isActive,
      roleNames: [...roleNames],
      version: user.version,
    };
  }
}
